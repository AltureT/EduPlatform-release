// 【公开入口】规格 §6.2
// shape({ key: rule }) → 校验函数 (payload, prefix?) => payload；失败抛 Error；默认拒绝未知键
//   K5：prefix（可选）是这份载荷在外层的路径（如 'tests'、'tests.cases[0]'），消息里的字段路径带上它：
//   "字段 tests.passed 应为 integer，收到 1.5"、"缺少字段 tests.cases[0].name"；内核分发只传一个参数，不受影响
// rule：'string' | 'string:1-16' | 'integer' | 'integer:0-100' | 'number' | 'boolean'
//       | 'enum:a,b,c' | 'array:<rule>' | 'object' | 'optional:<rule>'
// 裁决（已接受）：载荷为 undefined 时按 {} 处理（socket.emit(event) 不带载荷）；optional 键的值为 undefined 或 null 视为缺省
// K5：校验失败消息为中文、保留字段路径（经 error:validation 显示给学生），如"字段 name 应为 string，收到 number"、
//   "缺少字段 answer"、"不认识的字段 extra"；rule 写错（shape() 定义时抛的 "shape: …"）仍是给开发者看的英文

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 收到的值 → 类型名（null / array / NaN、Infinity 单独说）
const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return typeof v;
};
const wrongType = (p, want, v) => new Error(`字段 ${p} 应为 ${want}，收到 ${typeOf(v)}`);

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
        if (typeof v !== 'string') throw wrongType(p, 'string', v);
        if (range && (v.length < range.min || v.length > range.max)) {
          throw new Error(`字段 ${p} 长度应为 ${range.min}-${range.max}，收到 ${v.length}`);
        }
      };
    }
    case 'integer': {
      const range = arg === null ? null : parseRange(arg, rule, true);
      return (v, p) => {
        if (!Number.isInteger(v)) {
          // 非整数的有限数字直接给出值（"收到 1.5"），其余给类型名
          throw new Error(`字段 ${p} 应为 integer，收到 ${typeof v === 'number' && Number.isFinite(v) ? v : typeOf(v)}`);
        }
        if (range && (v < range.min || v > range.max)) throw new Error(`字段 ${p} 应在 ${range.min}-${range.max} 之间，收到 ${v}`);
      };
    }
    case 'number':
      if (arg !== null) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw wrongType(p, 'number', v);
      };
    case 'boolean':
      if (arg !== null) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (typeof v !== 'boolean') throw wrongType(p, 'boolean', v);
      };
    case 'object':
      if (arg !== null) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (!isPlainObject(v)) throw wrongType(p, 'object', v);
      };
    case 'enum': {
      const values = (arg ?? '').split(',').filter((s) => s.length > 0);
      if (values.length === 0) throw new Error(`shape: invalid rule "${rule}"`);
      return (v, p) => {
        if (typeof v !== 'string' || !values.includes(v)) {
          throw new Error(`字段 ${p} 应为 ${values.join('、')} 之一，收到 ${typeof v === 'string' ? JSON.stringify(v) : typeOf(v)}`);
        }
      };
    }
    case 'array': {
      if (!arg) throw new Error(`shape: invalid rule "${rule}"`);
      const item = compile(arg);
      return (v, p) => {
        if (!Array.isArray(v)) throw wrongType(p, 'array', v);
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

  return function validate(payload, prefix = '') {
    const pre = typeof prefix === 'string' && prefix ? prefix : '';
    const at = (k) => (pre ? `${pre}.${k}` : k);
    const obj = payload === undefined ? {} : payload;
    if (!isPlainObject(obj)) throw pre ? wrongType(pre, 'object', obj) : new Error(`载荷应为对象，收到 ${typeOf(obj)}`);
    for (const k of Object.keys(obj)) {
      if (!known.has(k)) throw new Error(`不认识的字段 ${at(k)}`);
    }
    for (const { key, optional, check } of fields) {
      const v = obj[key];
      if (v === undefined || (optional && v === null)) {
        if (optional) continue;
        throw new Error(`缺少字段 ${at(key)}`);
      }
      check(v, at(key));
    }
    return obj;
  };
}
