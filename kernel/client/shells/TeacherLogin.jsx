import { useState } from 'react';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import Btn from '../ui/Btn.jsx';
import Brand from './Brand.jsx';

export default function TeacherLogin() {
  const login = coreTeacherStore((s) => s.login);
  const connect = coreTeacherStore((s) => s.connect);
  const lesson = coreTeacherStore((s) => s.lesson);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    const result = await login(password);
    if (result.ok) {
      connect(result.token);
    } else {
      setError(result.error || '登录失败');
    }
    setLoading(false);
  };

  return (
    <div data-testid="teacher-login" className="teacher-app" style={{
      width: '100%',
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 'min(480px, 92%)',
        padding: 'clamp(24px, 4vw, 40px)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Brand glyph={lesson.glyph} title={lesson.title} size="lg" />
        </div>
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="教师密码"
            aria-label="教师密码"
            autoComplete="current-password"
            style={{
              width: '100%',
              padding: '12px 14px',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '1rem',
              fontFamily: 'inherit',
              background: 'var(--surface)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
          {error && (
            <div role="alert" style={{ fontSize: '0.8125rem', color: 'var(--bad)', marginTop: 8 }}>{error}</div>
          )}
        </div>
        <Btn type="submit" variant="primary" size="lg" disabled={!password || loading} style={{ width: '100%' }}>
          {loading ? '…' : '登录'}
        </Btn>
      </form>
    </div>
  );
}
