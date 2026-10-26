import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { handleUssd } from './ussd.js';
import { handleVoice } from './voice.js';
import { handleSms } from './sms.js';
import { api } from './api.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

function adminAuth(req, res, next) {
  if (!config.adminPassword) return next();
  const [, encoded = ''] = (req.headers.authorization || '').split(' ');
  const password = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
  if (password === config.adminPassword) return next();
  res.set('WWW-Authenticate', 'Basic realm="FieldPass admin"').status(401).send('Authentication required');
}

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

  // Public, non-secret info for the landing page
  app.get('/info.json', (req, res) => res.json({
    orgName: config.orgName,
    ussdCode: config.ussdCode,
    voiceNumber: config.at.voiceNumber,
    mode: config.dryRun ? 'dry-run' : config.at.sandbox ? 'sandbox' : 'live',
    callbacks: { ussd: `${baseUrl(req)}/ussd`, voice: `${baseUrl(req)}/voice`, sms: `${baseUrl(req)}/sms` },
  }));

  app.use(['/dashboard', '/simulator', '/api'], adminAuth);
  app.use('/api', api);
  app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
  app.get('/simulator', (req, res) => res.sendFile(path.join(publicDir, 'simulator.html')));
  app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));
  return app;
}
