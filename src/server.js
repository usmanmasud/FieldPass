import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { handleUssd } from './ussd.js';
import { handleVoice } from './voice.js';
import { handleSms } from './sms.js';
import { api } from './api.js';
import { isAuthed, login, logout, requireAuth } from './auth.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const viewsDir = path.join(root, 'views'); // admin pages, only served after login

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Africa's Talking callbacks
  app.post('/ussd', (req, res) => res.type('text/plain').send(handleUssd(req.body)));
  app.post('/voice', (req, res) => res.type('application/xml').send(handleVoice(req.body, req.query, baseUrl(req))));
  app.post('/sms', (req, res) => {
    Promise.resolve(handleSms(req.body)).catch((e) => console.error('[sms]', e));
    res.sendStatus(200);
  });

  // Public, non-secret info for the landing and login pages
  app.get('/info.json', (req, res) => res.json({
    orgName: config.orgName,
    ussdCode: config.ussdCode,
    voiceNumber: config.at.voiceNumber,
    mode: config.dryRun ? 'dry-run' : config.at.sandbox ? 'sandbox' : 'live',
    authRequired: Boolean(config.adminPassword),
    callbacks: { ussd: `${baseUrl(req)}/ussd`, voice: `${baseUrl(req)}/voice`, sms: `${baseUrl(req)}/sms` },
  }));

  app.get('/login', (req, res) => {
    const next = String(req.query.next || '');
    // Only same-site paths, never "//other.site"
    if (isAuthed(req)) return res.redirect(/^\/(?!\/)/.test(next) ? next : '/dashboard');
    res.sendFile(path.join(publicDir, 'login.html'));
  });
  app.post('/auth/login', login);
  app.post('/auth/logout', logout);

  app.use(['/dashboard', '/simulator', '/api'], requireAuth);
  app.use('/api', api);
  app.get('/dashboard', (req, res) => res.sendFile(path.join(viewsDir, 'dashboard.html')));
  app.get('/simulator', (req, res) => res.sendFile(path.join(viewsDir, 'simulator.html')));
  app.use(express.static(publicDir, { index: 'index.html' }));
  return app;
}
