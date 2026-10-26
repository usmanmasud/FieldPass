// Thin Africa's Talking REST client (SMS, Airtime, Voice).
// Every outbound action is also written to the `messages` table so the
// dashboard and simulator can show exactly what was sent.
import config from './config.js';
import { db } from './db.js';

const host = (svc) => `https://${svc}.${config.at.sandbox ? 'sandbox.' : ''}africastalking.com`;

async function post(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apiKey: config.at.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AT ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function log(channel, recipient, body, status, meta) {
  db.prepare('INSERT INTO messages (channel, recipient, body, status, meta) VALUES (?, ?, ?, ?, ?)')
    .run(channel, recipient, body, status, meta ? JSON.stringify(meta) : null);
}

export async function sendSms(to, message) {
  const recipients = [].concat(to).filter(Boolean);
  if (!recipients.length) return;
  if (config.dryRun) {
    for (const r of recipients) log('sms', r, message, 'dry-run');
    return;
  }
  try {
    const form = { username: config.at.username, to: recipients.join(','), message };
    if (config.at.senderId) form.from = config.at.senderId;
    const res = await post(`${host('api')}/version1/messaging`, form);
    const statuses = res?.SMSMessageData?.Recipients || [];
    for (const r of recipients) log('sms', r, message, statuses.find((s) => s.number === r)?.status || 'sent');
  } catch (e) {
    for (const r of recipients) log('sms', r, message, 'failed', { error: e.message });
  }
}

// Returns 'sent' | 'dry-run' | 'failed'
export async function sendAirtime(phone, amount) {
  const body = `${config.currency} ${amount}`;
  if (config.dryRun) {
    log('airtime', phone, body, 'dry-run');
    return 'dry-run';
  }
  try {
    const res = await post(`${host('api')}/version1/airtime/send`, {
      username: config.at.username,
      recipients: JSON.stringify([{ phoneNumber: phone, amount: body }]),
    });
    const entry = res?.responses?.[0];
    const ok = res?.numSent > 0 || /sent|success/i.test(entry?.status || '');
    log('airtime', phone, body, ok ? 'sent' : 'failed', res);
    return ok ? 'sent' : 'failed';
  } catch (e) {
    log('airtime', phone, body, 'failed', { error: e.message });
    return 'failed';
  }
}

// Outbound call; when answered AT hits POST /voice with direction=Outbound.
export async function call(phone, note) {
  if (config.dryRun || !config.at.voiceNumber) {
    log('voice', phone, note, 'dry-run');
    return;
  }
  try {
    const res = await post(`${host('voice')}/call`, { username: config.at.username, from: config.at.voiceNumber, to: phone });
    log('voice', phone, note, res?.entries?.[0]?.status || 'queued', res);
  } catch (e) {
    log('voice', phone, note, 'failed', { error: e.message });
  }
}
