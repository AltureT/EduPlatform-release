export default function Card({ children, style, pad = 20, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: pad,
        boxShadow: 'var(--shadow-soft)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
