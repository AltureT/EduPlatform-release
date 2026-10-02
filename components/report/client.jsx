// report 客户端：学生谢幕页看本人报告；教师谢幕页生成 / 导出 / 预览
// 布局（界面整理规格 §2.3 / §3.5）：两个谢幕槽位是谢幕页（tiles 模板）里的格子——ReportView 返回若干 <Tile>
// （Fragment，直接成为格子，不再嵌套 <Tiles>）；空态是一块标题为"个人报告"的 <Tile>；
// 教师预览某生报告走内核 Overlay 的 panel 形态（预览里自己包一层 <Tiles>）
// U6：条目 format === 'code'（值为字符串）时独立一行标签 + <CodeView size="sm" wrap>（左对齐、等宽、保留换行缩进、高亮；
//   折行而不横向滚动——手机扫码看报告、打印时不裁掉），其它条目照旧
// S22（上课细节收口规格 §7）：教师"生成并推送报告"三态——没推过（perClass.builtAt 为空）→ 原按钮；
//   确认后到 builtAt 变化之前 → 禁用的"生成中…"（15 s 兜底解除）；builtAt 有值 → soft 的"✓ 已推送 HH:MM"，再点两下重新生成
import { useEffect, useRef, useState } from 'react';
import {
  useComponent,
  useTeacherStage,
  Bar,
  Btn,
  Chip,
  CodeView,
  ConfirmAdvanceBtn,
  Overlay,
  Row,
  Stack,
  Tile,
  Tiles,
} from '#kernel/client/index.js';

const ID = 'report';

const fmtValue = (v) => {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const BUILD_FALLBACK_MS = 15000;
const ymd = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function CompareBar({ value, median }) {
  const max = Math.max(Math.abs(value), Math.abs(median)) || 1;
  const row = { display: 'grid', gridTemplateColumns: '4em 1fr 4em', gap: 8, alignItems: 'center', fontSize: 'var(--fs-xs)', color: 'var(--ink-soft)' };
  return (
    <div data-report-compare="" style={{ display: 'grid', gap: 4, marginTop: 6 }}>
      <div style={row}><span>本人</span><Bar value={Math.abs(value)} max={max} color="var(--brand)" /><span>{fmtValue(value)}</span></div>
      <div style={row}><span>中位数</span><Bar value={Math.abs(median)} max={max} color="var(--ink-dim)" /><span>{fmtValue(median)}</span></div>
    </div>
  );
}

function ReportItem({ item }) {
  if (item.format === 'code' && typeof item.value === 'string') {
    return (
      <div data-report-code="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>{item.label}</span>
        <CodeView code={item.value} size="sm" wrap />
      </div>
    );
  }
  const median = item.cohort?.median;
  const comparable = typeof item.value === 'number' && typeof median === 'number';
  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 'var(--fs-sm)' }}>
        <span style={{ color: 'var(--ink-soft)' }}>{item.label}</span>
        <span style={{ color: 'var(--ink)', textAlign: 'right', wordBreak: 'break-word' }}>{fmtValue(item.value)}</span>
      </div>
      {comparable && <CompareBar value={item.value} median={median} />}
    </div>
  );
}

export function ReportView({ report }) {
  if (!report?.sections) {
    return (
      <Tile title="个人报告">
        <div style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>报告尚未生成</div>
      </Tile>
    );
  }
  return (
    <>
      {report.sections.map((section) => (
        <Tile key={section.stageId} title={section.label}>
          <div>
            {section.items.map((item, i) => <ReportItem key={i} item={item} />)}
          </div>
        </Tile>
      ))}
    </>
  );
}

function StudentCurtain() {
  const { data } = useComponent(ID);
  return <ReportView report={data.my} />;
}

function TeacherCurtain() {
  const { send, data, authFetch, lesson } = useComponent(ID);
  const { roster } = useTeacherStage('curtain');
  const [selected, setSelected] = useState(null);
  const [exportError, setExportError] = useState(null);

  const perStudent = data.perStudent ?? {};
  const built = roster.filter((s) => perStudent[s.name]?.builtAt != null).length;
  const builtAt = data.perClass?.builtAt ?? null;

  // building：点了确认之后、builtAt 变化之前（记下点击时的 builtAt，变了就解除；15 s 兜底）
  const [building, setBuilding] = useState(null);   // null | { from }
  const fallback = useRef(null);
  useEffect(() => () => clearTimeout(fallback.current), []);
  useEffect(() => {
    if (building && builtAt !== building.from) {
      clearTimeout(fallback.current);
      setBuilding(null);
    }
  }, [builtAt, building]);
  const build = () => {
    send('report:t-build', {});
    setBuilding({ from: builtAt });
    clearTimeout(fallback.current);
    fallback.current = setTimeout(() => setBuilding(null), BUILD_FALLBACK_MS);
  };

  const exportCsv = async () => {
    setExportError(null);
    try {
      const res = await authFetch('/api/export.csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `classroom-${lesson?.id ?? 'lesson'}-${ymd()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err?.message ?? String(err));
    }
  };

  return (
    <>
      <Tile title="个人报告">
        <Stack gap={3}>
          <Row gap={2}>
            {building && <Btn disabled>生成中…</Btn>}
            {!building && builtAt == null && (
              <ConfirmAdvanceBtn onAdvance={build} confirmLabel="确认生成">
                生成并推送报告
              </ConfirmAdvanceBtn>
            )}
            {!building && builtAt != null && (
              <ConfirmAdvanceBtn variant="soft" onAdvance={build} confirmLabel="确认重新生成">
                {`✓ 已推送 ${hhmm(builtAt)}`}
              </ConfirmAdvanceBtn>
            )}
            <Chip tone="neutral">{`已生成 ${built} / ${roster.length}`}</Chip>
            <Btn variant="ghost" onClick={exportCsv}>导出 CSV</Btn>
            {exportError && <Chip tone="bad">{exportError}</Chip>}
          </Row>
          <Row gap={2}>
            {roster.map((s) => (
              <Btn
                key={s.name}
                variant={selected === s.name ? 'primary' : 'soft'}
                style={s.connected === false ? { color: 'var(--ink-dim)' } : undefined}
                onClick={() => setSelected(s.name)}
              >
                {s.name}
              </Btn>
            ))}
          </Row>
        </Stack>
      </Tile>
      {selected != null && (
        <Overlay variant="panel" label={`报告 · ${selected}`} testId="report-preview" onDismiss={() => setSelected(null)}>
          <Row gap={3} wrap={false}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--ink)' }}>{selected}</span>
            <Btn variant="ghost" aria-label="关闭" onClick={() => setSelected(null)}>✕</Btn>
          </Row>
          <Tiles gap={3}>
            <ReportView report={perStudent[selected]} />
          </Tiles>
        </Overlay>
      )}
    </>
  );
}

export default {
  slots: {
    teacherCurtain: TeacherCurtain,
    studentCurtain: StudentCurtain,
  },
};
