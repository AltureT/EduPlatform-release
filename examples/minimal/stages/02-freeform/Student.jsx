import { useEffect, useRef } from 'react';
import { useStudentStage, useDraft, Btn, Page, Fill } from '#kernel/client/index.js';
import { MAX_LENGTH } from './stage.config.js';

// 页面样式 focus（stage.config.js 的 layout）：输入框进 Main 并撑满，字数进 hint，主按钮"保存"进 Actions（外壳操作条）
export default function Student() {
  const { stage, isLive, myData, send } = useStudentStage('freeform');
  const saved = myData?.text ?? '';
  // 学生输入一律 useDraft（刷新、断线、关浏览器、换设备不丢）：没改过时显示已保存的内容
  const [draftRaw, setDraft, { clear }] = useDraft('text', null, { stageId: 'freeform' });
  const draft = typeof draftRaw === 'string' ? draftRaw : saved;

  // 服务端回执（已保存的内容变了）后清掉草稿，显示已保存的内容；挂载时不清
  const seen = useRef(saved);
  useEffect(() => {
    if (seen.current === saved) return;
    seen.current = saved;
    clear();
  }, [saved, clear]);

  // 与服务端 schema 一致：按 UTF-16 .length 计数与截断
  const length = draft.length;
  const dirty = draft !== saved;

  const onChange = (e) => setDraft(e.target.value.slice(0, MAX_LENGTH));

  return (
    <Page template="focus" title={stage?.label} hint={`${length}/${MAX_LENGTH}`}>
      <Page.Main>
        <Fill>
          <textarea
            value={draft}
            onChange={onChange}
            maxLength={MAX_LENGTH}
            disabled={!isLive}
            rows={6}
            aria-label="作答"
            style={{
              flex: 1,
              width: '100%',
              boxSizing: 'border-box',
              padding: 12,
              fontSize: 'var(--fs-md)',
              fontFamily: 'inherit',
              resize: 'none',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
            }}
          />
        </Fill>
      </Page.Main>
      <Page.Actions>
        <Btn variant="primary" disabled={!isLive || !dirty} onClick={() => send('student:write', { text: draft })}>
          保存
        </Btn>
      </Page.Actions>
    </Page>
  );
}
