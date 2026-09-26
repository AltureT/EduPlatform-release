// 段 4 学生页与演示页共用的调参面板零件（只在本段目录内使用）
import { Stack, Row, Bar, Chip } from '#kernel/client/index.js';
import { FEATURES, SAMPLES, WEIGHT_MAX, THRESHOLD_MAX, scoreOf } from './data.js';

export const DEFAULT_WEIGHTS = Object.fromEntries(FEATURES.map((f) => [f.key, 20]));
export const DEFAULT_THRESHOLD = 60;

function Slider({ label, value, max, step, disabled, onChange }) {
  return (
    <Row gap={3} wrap={false}>
      <span style={{ flex: '0 0 7em' }}>{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ flex: '0 0 3em', textAlign: 'right', fontWeight: 600 }}>{value}</span>
    </Row>
  );
}

// 特征工具箱：每个特征一个权重滑杆 + 一条线的滑杆
export function Sliders({ weights, threshold, disabled, onWeight, onThreshold }) {
  return (
    <Stack gap={2}>
      {FEATURES.map((f) => (
        <Slider key={f.key} label={f.label} value={weights[f.key]} max={WEIGHT_MAX} step={5} disabled={disabled} onChange={(v) => onWeight(f.key, v)} />
      ))}
      <Slider label="线（拦截分）" value={threshold} max={THRESHOLD_MAX} step={5} disabled={disabled} onChange={onThreshold} />
    </Stack>
  );
}

// 分数轴：100 条样本按得分排开，诈骗 / 正常两色，竖线是线的位置
export function ScoreAxis({ weights, threshold }) {
  const W = 600;
  const H = 150;
  const maxScore = Math.max(THRESHOLD_MAX, ...SAMPLES.map((s) => scoreOf(s, weights)));
  const x = (v) => 20 + (v / maxScore) * (W - 40);
  const stacks = new Map();
  const dots = SAMPLES.map((s) => {
    const sc = scoreOf(s, weights);
    const bin = Math.round(x(sc) / 8);
    const n = stacks.get(bin) ?? 0;
    stacks.set(bin, n + 1);
    return { id: s.id, cx: bin * 8, cy: H - 24 - n * 7, scam: s.type !== 'normal' };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="分数轴">
      <line x1={20} y1={H - 18} x2={W - 20} y2={H - 18} stroke="var(--border-strong)" />
      {dots.map((d) => (
        <circle key={d.id} cx={d.cx} cy={Math.max(6, d.cy)} r={3} fill={d.scam ? 'var(--bad)' : 'var(--good)'} />
      ))}
      <line x1={x(threshold)} y1={4} x2={x(threshold)} y2={H - 12} stroke="var(--brand)" strokeWidth={2} />
      <text x={x(threshold) + 4} y={14} fontSize={12} fill="var(--brand)">线 {threshold}</text>
      <text x={20} y={H - 2} fontSize={11} fill="var(--ink-dim)">0</text>
      <text x={W - 20} y={H - 2} fontSize={11} fill="var(--ink-dim)" textAnchor="end">{maxScore}</text>
    </svg>
  );
}

// 实验轨迹：每次检验的 F1（实线）与查全（虚线）
export function Trajectory({ history }) {
  const W = 600;
  const H = 110;
  if (!history?.length) return null;
  const step = history.length > 1 ? (W - 40) / (history.length - 1) : 0;
  const pts = (key) => history.map((h, i) => `${20 + i * step},${H - 12 - h[key] * (H - 24)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="实验轨迹">
      <line x1={20} y1={H - 12} x2={W - 20} y2={H - 12} stroke="var(--border-strong)" />
      <polyline points={pts('recall')} fill="none" stroke="var(--accent)" strokeDasharray="4 3" strokeWidth={2} />
      <polyline points={pts('f1')} fill="none" stroke="var(--brand)" strokeWidth={2} />
      {history.map((h, i) => (
        <circle key={i} cx={20 + i * step} cy={H - 12 - h.f1 * (H - 24)} r={3} fill={h.success ? 'var(--good)' : 'var(--bad)'} />
      ))}
      <text x={W - 20} y={12} fontSize={11} fill="var(--ink-dim)" textAnchor="end">F1 实线 · 查全 虚线</text>
    </svg>
  );
}

// 特征贡献：被拦下的短信里，每个特征一共贡献了多少分
export function Contribution({ weights, threshold }) {
  const flagged = SAMPLES.filter((s) => scoreOf(s, weights) >= threshold);
  const items = FEATURES.map((f) => ({ ...f, value: flagged.filter((s) => s.features.includes(f.key)).length * weights[f.key] }));
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Stack gap={1}>
      {items.map((i) => (
        <Row key={i.key} gap={2} wrap={false}>
          <span style={{ flex: '0 0 7em', fontSize: 'var(--fs-sm)' }}>{i.label}</span>
          <span style={{ flex: 1 }}>
            <Bar value={i.value} max={max} />
          </span>
          <span style={{ flex: '0 0 3em', textAlign: 'right', fontSize: 'var(--fs-sm)' }}>{i.value}</span>
        </Row>
      ))}
    </Stack>
  );
}

// 成绩一行：抓到、误拦、查全、查准、F1
export function ResultChips({ result }) {
  if (!result) return null;
  const pct = (x) => `${Math.round(x * 100)}%`;
  return (
    <Row gap={2}>
      <Chip tone="brand">抓到 {result.caught}/60</Chip>
      <Chip tone={result.blocked > 5 ? 'bad' : 'neutral'}>误拦 {result.blocked}/40</Chip>
      <Chip tone="outline">查全 {pct(result.recall)}</Chip>
      <Chip tone="outline">查准 {pct(result.precision)}</Chip>
      <Chip tone="outline">F1 {result.f1}</Chip>
    </Row>
  );
}
