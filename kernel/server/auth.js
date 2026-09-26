// 教师鉴权（规格 §5.3，搬 AF routes/auth.js）：POST /api/auth、GET /api/auth/verify
// token 持久化到 AUTH_TOKEN_FILE（默认 data/teacher_tokens.json，相对 cwd），重启后旧 token 仍有效
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const router = Router();

const TOKEN_FILE = process.env.AUTH_TOKEN_FILE || path.resolve(process.cwd(), 'data', 'teacher_tokens.json');
const tokens = new Set();

try {
  if (fs.existsSync(TOKEN_FILE)) {
    const stored = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (Array.isArray(stored)) {
      for (const t of stored) if (typeof t === 'string' && t.length) tokens.add(t);
    }
  }
} catch (e) {
  console.warn('[auth] load tokens failed:', e.message);
}

function persistTokens() {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify([...tokens]));
  } catch (e) {
    console.warn('[auth] save tokens failed:', e.message);
  }
}

router.post('/auth', (req, res) => {
  const password = req.body?.password;
  if (!password || password !== process.env.TEACHER_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  tokens.add(token);
  persistTokens();
  res.json({ token });
});

router.get('/auth/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && tokens.has(token)) {
    return res.json({ valid: true });
  }
  res.status(401).json({ valid: false });
});

export { router, tokens };
export default router;
