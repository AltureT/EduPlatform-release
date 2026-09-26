// 冻结接口（规格 §10）：teacherToken(base, password) → Promise<token>；非 200 抛错
export async function teacherToken(base, password) {
  const res = await fetch(`${base}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`teacherToken: POST ${base}/api/auth → ${res.status} ${text}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`teacherToken: response not JSON: ${text}`);
  }
  if (!body || typeof body.token !== 'string') {
    throw new Error(`teacherToken: response has no token: ${text}`);
  }
  return body.token;
}
