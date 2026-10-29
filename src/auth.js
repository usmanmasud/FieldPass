// Cookie session for the admin area (dashboard, simulator, /api).
// Stateless: the cookie is "<expiry>.<hmac>" signed with a key derived from
// ADMIN_PASSWORD, so changing the password logs everyone out.
import crypto from 'node:crypto';
import config from './config.js';

const COOKIE = 'fp_session';
const TTL_MS = 7 * 24 * 3600e3;
const key = crypto.createHash('sha256').update(`fieldpass-session:${config.adminPassword}`).digest();
const hmac = (s) => crypto.createHmac('sha256', key).update(s).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req) {
  const match = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : '';
}

export function isAuthed(req) {
  if (!config.adminPassword) return true;
  const [exp, sig] = readCookie(req).split('.');
  return Boolean(exp && sig && Number(exp) > Date.now() && safeEqual(sig, hmac(exp)));
}

// Simple brute-force brake: 8 failed attempts per IP per 15 minutes.
const failures = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (failures.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  failures.set(ip, recent);
  return recent.length >= 8;
}

export function login(req, res) {
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!config.adminPassword || !safeEqual(req.body?.password ?? '', config.adminPassword)) {
    failures.get(req.ip).push(Date.now());
    return res.status(401).json({ error: 'Wrong password' });
  }
  const exp = String(Date.now() + TTL_MS);
  res.cookie(COOKIE, `${exp}.${hmac(exp)}`, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: TTL_MS, path: '/',
  });
  res.json({ ok: true });
}

export function logout(req, res) {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}
