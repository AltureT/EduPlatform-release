// studentOverlay 槽位（规格 §3.7、§3.2a、§3.10）：学生端顶层，承载
// - configure({ standby })：挂载时把 lesson 级 options.standby 交进 pythonClient 单例
// - 预载：当前阶段有 sandbox 配置 → 立即 lesson 级包 → 本阶段包 / flask → files；
//   否则 preload:'join'（默认）时空闲后（requestIdleCallback，无则 setTimeout 1 s）加载 lesson 级包；preload:'stage' 时不加载
// - 信箱 key 登记：pythonClient 每建一个 Worker（worker-created）与每次 stdin-request 都发 sandbox:s-stdin-key
// - sandbox:s-status 的唯一发送方（status.js）
// - 加载失败：把文案与 [重试] 交给 loadAlert.js，由 studentBanner 槽位在学生横幅区显示一行（契约 v0.7.1 §八，不挡页面）；
//   浏览器太旧（S3）只给提示，不给 [重试]。本槽位自己不渲染任何界面
// - classroom:reset 时清本课 localStorage 草稿键（S3：overlay 常驻，学生不在代码阶段时也清；PyRunner 里另有一份，以这里为准）
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useComponent, registerKernelHook } from '#kernel/client/index.js';
import { useSandboxConfig } from '../stageConfig.js';
import { usePython } from '../usePython.js';
import { getPythonClient } from '../pythonClient.js';
import { pageState, readyLevel, createStatusReporter, resetPageCounts } from './status.js';
import { clearLessonDrafts } from '../ui/draftStorage.js';
import { isUnsupportedError } from '../compat.js';
import { setLoadAlert } from './loadAlert.js';

const IDLE_FALLBACK_MS = 1000;

function whenIdle(fn) {
  const ric = globalThis.requestIdleCallback;
  if (typeof ric === 'function') {
    const h = ric(fn, { timeout: 5000 });
    return () => globalThis.cancelIdleCallback?.(h);
  }
  const t = setTimeout(fn, IDLE_FALLBACK_MS);
  return () => clearTimeout(t);
}

function SandboxOverlay({ c }) {
  const client = getPythonClient();
  const py = usePython();
  const stageId = c.currentStage.id;
  const cfg = useSandboxConfig(stageId);
  const sb = c.isEnabledFor(stageId) ? cfg : null;
  const opts = c.options;
  const [, bump] = useReducer((x) => x + 1, 0);
  const [loadError, setLoadError] = useState(null);
  const [retryN, setRetryN] = useState(0);

  const ps = pageState();
  const level = readyLevel({
    status: py.status, phase: py.progress?.phase, coreDone: ps.coreDone, stageDone: ps.stageDone.has(stageId), stageId, hasConfig: !!sb,
  });
  const levelRef = useRef(level);
  levelRef.current = level;
  const stageRef = useRef(stageId);
  stageRef.current = stageId;
  const sendRef = useRef(c.send);
  sendRef.current = c.send;

  // 上报器：挂载即发一次（页面加载时为 none）
  const reporter = useRef(null);
  useEffect(() => {
    const rep = createStatusReporter({
      send: (e, p) => sendRef.current(e, p),
      getStageId: () => stageRef.current,
      getReady: () => levelRef.current,
    });
    reporter.current = rep;
    rep.start();
    return () => {
      rep.dispose();
      reporter.current = null;
    };
  }, []);

  useEffect(() => {
    client.configure({ standby: opts.standby });
  }, [client, opts.standby]);

  // key 登记 + 运行结束计数
  useEffect(() => client.subscribe((ev) => {
    if (!ev) return;
    if (ev.type === 'worker-created' || ev.type === 'stdin-request') {
      try {
        sendRef.current('sandbox:s-stdin-key', { key: ev.key });
      } catch (e) {
        console.warn('[sandbox] s-stdin-key 发送失败', e);
      }
    } else if (ev.type === 'run-end') {
      reporter.current?.runEnd(ev);
    }
  }), [client]);

  const lessonRef = useRef(c.lesson?.id ?? null);
  lessonRef.current = c.lesson?.id ?? null;
  useEffect(() => registerKernelHook('reset', () => {
    resetPageCounts();
    clearLessonDrafts(lessonRef.current);
  }), []);

  // 就绪级别 / 阶段变化 → 合并发送（首次渲染由 start() 覆盖）
  const seen = useRef({ level, stageId });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { level, stageId };
    if (prev.stageId !== stageId) reporter.current?.stageChanged();
    else if (prev.level !== level) reporter.current?.readyChanged();
  }, [level, stageId]);

  // 预载
  useEffect(() => {
    let cancelled = false;
    const lessonPk = Array.isArray(opts.packages) ? opts.packages : [];
    const lessonFlask = !!opts.flask;
    const load = async () => {
      if (!cancelled) setLoadError(null);   // 重新加载先清掉上次的错误（横幅与 s-status 一致）
      try {
        await client.ensure(lessonPk, { flask: lessonFlask });
        ps.coreDone = true;
        if (!cancelled) bump();
        if (sb) {
          await client.ensure(Array.isArray(sb.packages) ? sb.packages : [], { flask: !!sb.flask });
          if (sb.files && Object.keys(sb.files).length > 0) await client.writeFiles(sb.files);
          ps.stageDone.add(stageId);
          if (!cancelled) bump();
        }
        if (!cancelled) setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          setLoadError(String(e?.message ?? e));
          setLoadAlert({ hidden: false });
        }
      }
    };
    if (sb) {
      load();
      return () => {
        cancelled = true;
      };
    }
    if (opts.preload === 'stage') return undefined;
    const cancel = whenIdle(load);
    return () => {
      cancelled = true;
      cancel();
    };
  }, [client, stageId, sb, opts, retryN, ps]);

  // 运行环境从别的入口（PyRunner 的 [重试]、[⟳ 重启运行环境]）恢复：出现过 failed 之后回到 ready 时本槽位重新加载，
  // 清掉自己记着的旧错误，并把本阶段 files 补写上。只在到 ready 时触发（不在 failed → loading 时触发），
  // 以免本槽位自己的 [重试] 引起的 loading 再叠一次加载
  const sawFailed = useRef(py.status === 'failed');
  useEffect(() => {
    if (py.status === 'failed') sawFailed.current = true;
    else if (py.status === 'ready' && sawFailed.current) {
      sawFailed.current = false;
      setRetryN((n) => n + 1);
    }
  }, [py.status]);

  const failed = py.status === 'failed';
  const message = failed ? py.error : loadError;
  const retry = useCallback(() => setRetryN((n) => n + 1), []);
  useEffect(() => {
    setLoadAlert({ message: message || null, retry: message && !isUnsupportedError(message) ? retry : null });
  }, [message, retry]);
  useEffect(() => {
    if (failed) setLoadAlert({ hidden: false });
  }, [failed, py.error]);
  useEffect(() => () => setLoadAlert({ message: null, retry: null, hidden: false }), []);

  return null;
}

export default function StudentOverlay() {
  const c = useComponent('sandbox');
  if (c.role !== 'student') return null;
  return <SandboxOverlay c={c} />;
}
