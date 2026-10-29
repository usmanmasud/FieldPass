// Admin area is behind a cookie login; Africa's Talking callbacks stay open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 's3cret-pass';

const { createApp } = await import('../src/server.js');
let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });

test('pages redirect to login and the API returns 401 without a session', async () => {
  let r = await get('/dashboard');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?next=%2Fdashboard');
  r = await get('/api/overview');
  assert.equal(r.status, 401);
  // admin pages are not reachable as static files
  assert.equal((await get('/dashboard.html')).status, 404);
  assert.equal((await get('/simulator.html')).status, 404);
});

test('callbacks and public pages need no login', async () => {
  const r = await fetch(`${base}/ussd`, { method: 'POST', body: new URLSearchParams({ sessionId: 'a', phoneNumber: '+2348000000001', text: '' }) });
  assert.match(await r.text(), /^CON /);
  assert.equal((await get('/login')).status, 200);
  assert.equal((await get('/info.json')).status, 200);
});

test('wrong password is rejected, right password grants a session', async () => {
  const login = (password) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal((await login('nope')).status, 401);

  const r = await login('s3cret-pass');
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);

  assert.equal((await get('/api/overview', { cookie })).status, 200);
  assert.equal((await get('/dashboard', { cookie })).status, 200);
  assert.equal((await get('/api/overview', { cookie: `${cookie}x` })).status, 401, 'tampered cookie');
  // already signed in: /login bounces to the dashboard, never off-site
  assert.equal((await get('/login?next=//evil.com', { cookie })).headers.get('location'), '/dashboard');
});
