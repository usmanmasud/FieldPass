// JSON API behind the dashboard and simulator.
import express from 'express';
import config from './config.js';
import { db, queryFields } from './db.js';
import { normalizePhone } from './util.js';
import { runJobs } from './jobs.js';
import { seedDemo } from './seed/demo.js';

export const api = express.Router();

api.get('/overview', (req, res) => {
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM fields GROUP BY status').all().map((r) => [r.status, r.n]));
  res.json({
    stats: {
      standing: byStatus.standing || 0,
      open: byStatus.open || 0,
      booked: byStatus.booked || 0,
      harvested: (byStatus.harvested || 0) + (byStatus.closed || 0),
      dealsCompleted: count("SELECT COUNT(*) n FROM bookings WHERE status = 'completed'"),
      openIncidents: count("SELECT COUNT(*) n FROM incidents WHERE status = 'open'"),
      farmers: count("SELECT COUNT(*) n FROM users WHERE role = 'farmer'"),
      herders: count("SELECT COUNT(*) n FROM users WHERE role = 'herder'"),
      airtime: count("SELECT COALESCE(SUM(amount), 0) n FROM rewards WHERE status IN ('sent', 'dry-run')"),
    },
    wards: db.prepare(`SELECT w.*, (SELECT COUNT(*) FROM fields f WHERE f.ward_id = w.id AND f.status = 'standing') AS standing,
                       (SELECT COUNT(*) FROM fields f WHERE f.ward_id = w.id AND f.status = 'open') AS open
                       FROM wards w ORDER BY w.code`).all(),
    fields: queryFields('1 = 1 ORDER BY f.id'),
    incidents: db.prepare(`SELECT i.*, f.crop, f.landmark, f.ward_id, w.name AS ward_name, u.name AS reporter_name
                           FROM incidents i JOIN fields f ON f.id = i.field_id JOIN wards w ON w.id = f.ward_id
                           LEFT JOIN users u ON u.phone = i.reporter_phone ORDER BY i.id DESC LIMIT 50`).all(),
    bookings: db.prepare(`SELECT b.*, f.crop, w.name AS ward_name, h.name AS herder_name, fu.name AS farmer_name
                          FROM bookings b JOIN fields f ON f.id = b.field_id JOIN wards w ON w.id = f.ward_id
                          LEFT JOIN users h ON h.phone = b.herder_phone LEFT JOIN users fu ON fu.phone = f.farmer_phone
                          ORDER BY b.id DESC LIMIT 50`).all(),
    mediators: db.prepare('SELECT m.*, w.name AS ward_name FROM mediators m LEFT JOIN wards w ON w.id = m.ward_id ORDER BY m.id').all(),
    users: db.prepare(`SELECT u.phone, u.name, u.role, u.lang, u.created_at, w.name AS ward_name,
                       (SELECT COUNT(*) FROM fields f WHERE f.farmer_phone = u.phone) AS fields,
                       (SELECT COUNT(*) FROM bookings b WHERE b.herder_phone = u.phone)
                         + (SELECT COUNT(*) FROM bookings b JOIN fields f ON f.id = b.field_id WHERE f.farmer_phone = u.phone) AS deals,
                       (SELECT COALESCE(SUM(amount), 0) FROM rewards r WHERE r.phone = u.phone AND r.status IN ('sent', 'dry-run')) AS airtime
                       FROM users u LEFT JOIN wards w ON w.id = u.ward_id ORDER BY u.created_at DESC`).all(),
    messages: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 200').all(),
    info: {
      ussdCode: config.ussdCode,
      mode: config.dryRun ? 'dry-run' : config.at.sandbox ? 'sandbox' : 'live',
      authRequired: Boolean(config.adminPassword),
    },
  });
});

api.get('/messages', (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const since = Number(req.query.since) || 0;
  res.json(db.prepare('SELECT * FROM messages WHERE recipient = ? AND id > ? ORDER BY id').all(phone, since));
});

api.post('/wards', (req, res) => {
  const { code, name, lga, lat, lng } = req.body;
  if (!code || !name || !lga) return res.status(400).json({ error: 'code, name and lga are required' });
  try {
    db.prepare('INSERT INTO wards (code, name, lga, lat, lng) VALUES (?, ?, ?, ?, ?)')
      .run(String(code), name, lga, lat === '' || lat == null ? null : Number(lat), lng === '' || lng == null ? null : Number(lng));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.post('/mediators', (req, res) => {
  const { name, phone, role, ward_id: wardId } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
  db.prepare('INSERT INTO mediators (name, phone, role, ward_id) VALUES (?, ?, ?, ?)')
    .run(name, normalizePhone(phone), role || null, wardId ? Number(wardId) : null);
  res.json({ ok: true });
});

api.delete('/mediators/:id', (req, res) => {
  db.prepare('DELETE FROM mediators WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

api.post('/incidents/:id/resolve', (req, res) => {
  db.prepare("UPDATE incidents SET status = 'resolved' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

api.post('/jobs/run', (req, res) => res.json(runJobs()));

api.post('/demo/seed', (req, res) => res.json(seedDemo()));

api.get('/config', (req, res) => res.json({ ussdCode: config.ussdCode, orgName: config.orgName }));
