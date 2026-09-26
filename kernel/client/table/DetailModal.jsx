// 规格 §9.3：DetailModal({ name, tabs:[{ id, label, render(snapshot) }], onClose })
// 挂载时按 name 调 fetchStudentDetail，卸载时 clearStudentDetail；
// snapshot === undefined 加载中，null 为空；数据来自 teacher:student-detail
// v0.7：外层走内核 Overlay（panel），内容 max-height 不超过 100dvh、内部滚动
import { useEffect, useState } from 'react';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import Btn from '../ui/Btn.jsx';
import Overlay from '../shells/Overlay.jsx';

export default function DetailModal({ name, tabs = [], onClose }) {
  const detail = coreTeacherStore((s) => s.studentDetail);
  const [tabId, setTabId] = useState(tabs[0] ? tabs[0].id : null);

  useEffect(() => {
    const st = coreTeacherStore.getState();
    st.fetchStudentDetail(name);
    return () => coreTeacherStore.getState().clearStudentDetail();
  }, [name]);

  const snapshot = detail && detail.name === name ? detail.snapshot : undefined;
  const isLoading = snapshot === undefined;
  const isEmpty = snapshot === null;
  const active = tabs.find((t) => t.id === tabId) || tabs[0] || null;
  const close = () => { if (typeof onClose === 'function') onClose(); };

  return (
    <Overlay variant="panel" label={name} onDismiss={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{name}</span>
          <Btn variant="ghost" onClick={close}>关闭</Btn>
        </div>

        {!isLoading && !isEmpty && tabs.length > 1 && (
          <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
            {tabs.map((t) => {
              const on = active && t.id === active.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTabId(t.id)}
                  style={{
                    height: 'var(--control-h)', padding: '0 16px', fontSize: 'var(--fs-sm)',
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    borderBottom: on ? '2px solid var(--brand)' : '2px solid transparent',
                    color: on ? 'var(--brand)' : 'var(--ink-dim)',
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {isLoading && (
          <div data-testid="detail-loading" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-dim)' }}>
            加载中…
          </div>
        )}
        {isEmpty && (
          <div data-testid="detail-empty" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-dim)' }}>
            暂无数据
          </div>
        )}
        {!isLoading && !isEmpty && active && typeof active.render === 'function' && (
          <div data-testid="detail-body">{active.render(snapshot)}</div>
        )}
      </div>
    </Overlay>
  );
}
