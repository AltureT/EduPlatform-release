// 代码配色的 token 表（代码展示统一高亮规格 §3）：静态的 <CodeView> 与 sandbox 的 CodeMirror 编辑器共用，两边颜色一致。
// 每项 { name, tag }：name → 类名 tok-<name>（CodeView，样式在 global.css）与令牌 --code-<name>（编辑器的 HighlightStyle）；
// tag 是 @lezer/highlight 的标签（@lezer/python 的 styleTags 产出）。同一节点有多条规则匹配时，修饰更具体的那条胜出
// （如函数定义名 function(definition(variableName)) 取 def，不取 variable）。
// 复核 2：函数调用名（print(、len(、df.mean( 的 print / len / mean）也归 def 色，不另设令牌。
import { tags as t } from '@lezer/highlight';

export const CODE_TOKENS = [
  { name: 'keyword', tag: [t.keyword] },                                                       // if / for / def / import / in / and …
  { name: 'string', tag: [t.string, t.special(t.string), t.escape] },
  { name: 'comment', tag: [t.comment] },
  { name: 'number', tag: [t.number] },
  { name: 'def', tag: [t.definition(t.variableName), t.definition(t.className), t.className, t.function(t.variableName), t.function(t.propertyName)] },   // 函数 / 类的定义名与调用名
  { name: 'builtin', tag: [t.bool, t.null, t.atom, t.self, t.standard(t.variableName)] },          // 只指 True / False / None 这类常量
  { name: 'operator', tag: [t.operator] },                                                     // = + - * / == < 与属性的点
  { name: 'variable', tag: [t.variableName, t.propertyName] },
];
