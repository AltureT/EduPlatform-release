// 【公开入口】规格 §6.2
// shape({ key: rule }) → 校验函数 (payload) => payload；失败抛 Error；默认拒绝未知键
// rule：'string' | 'string:1-16' | 'integer' | 'integer:0-100' | 'number' | 'boolean'
//       | 'enum:a,b,c' | 'array:<rule>' | 'object' | 'optional:<rule>'
// 裁决（已接受）：载荷为 undefined 时按 {} 处理（socket.emit(event) 不带载荷）；optional 键的值为 undefined 或 null 视为缺省

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseRange(spec, rule, integerOnly) {
  const m = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(spec);
  if (!m) throw new Error(`shape: invalid range in rule "${rule}"`);
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (integerOnly && (!Number.isInteger(min) || !Number.isInteger(max))) {
    throw new Error(`shape: invalid range in rule "${rule}"`);
  }
  if (min > max) throw new Error(`shape: invalid range in rule "${rule}"`);
  return { min, max };
}

// 编译 rule → (value, path) => void，失败抛 Error
function compile(rule) {
  if (typeof rule !== 'string' || rule.length === 0) {
    throw new Error(`shape: invalid rule ${JSON.stringify(rule)}`);
  }
  const idx = rule.indexOf(':');
  const kind = idx === -1 ? rule : rule.slice(0, idx);
  const arg = idx === -1 ? null : rule.slice(idx + 1);

  switch (kind) {
    case 'string': {
      const range = arg === null ? null : parseRange(arg, rule, true);
      return (v, p) => {
        if (typeof v !== 'string') throw new Error(`${p}: expected string`);
        if (range && (v.length < range.min || v.length > range.max)) {
          throw new Error(`${p}: length must be ${range.min}-${range.max}`);
        }
      };
    }
    case 'integer': {
      const range = arg === null ? null : parseRange(arg, rule, true);
      return (v, p) => {
        if (!Number.isInteger(v)) throw new Error(`${p}: expected integer`);
        if (range && (v < range.min || v > range.max)) throw new Error(`${p}: must be ${range.min}-${range.max}`);
      };
    }
    case 'number':
      if (arg !== null) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${p}: expected number`);
      };
    case 'boolean':
      if (arg !== null) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (typeof v !== 'boolean') throw new Error(`${p}: expected boolean`);
      };
    case 'object':
      if (arg !== null) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (!isPlainObject(v)) throw new Error(`${p}: expected object`);
      };
    case 'enum': {
      const values = (arg ?? '').split(',').filter((s) => s.length > 0);
      if (values.length === 0) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (typeof v !== 'string' || !values.includes(v)) throw new Error(`${p}: must be one of ${values.join(',')}`);
      };
    }
    case 'array': {
      if (!arg) throw new Error(`shape: invalid rule "${rule}"`);
      const item = compile(arg);
      return (v, p) => {
        if (!Array.isArray(v)) throw new Error(`${p}: expected array`);
        v.forEach((x, i) => item(x, `${p}[${i}]`));
      };
    }
    default:
      throw new Error(`shape: unknown rule "${rule}"`);
  }
}

export function shape(rules) {
  if (!isPlainObject(rules)) throw new Error('shape: rules must be an object');
  const fields = Object.entries(rules).map(([key, rule]) => {
    const optional = typeof rule === 'string' && rule.startsWith('optional:');
    const check = compile(optional ? rule.slice('optional:'.length) : rule);
    return { key, optional, check };
  });
  const known = new Set(Object.keys(rules));

  return function validate(payload) {
    const obj = payload === undefined ? {} : payload;
    if (!isPlainObject(obj)) throw new Error('payload: expected object');
    for (const k of Object.keys(obj)) {
      if (!known.has(k)) throw new Error(`${k}: unknown key`);
    }
    for (const { key, optional, check } of fields) {
      const v = obj[key];
      if (v === undefined || (optional && v === null)) {
        if (optional) continue;
        throw new Error(`${key}: required`);
      }
      check(v, key);
    }
    return obj;
  };
}
