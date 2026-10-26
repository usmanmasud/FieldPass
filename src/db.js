import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS wards (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  lga TEXT NOT NULL,
  lat REAL,
  lng REAL
);

CREATE TABLE IF NOT EXISTS users (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,              -- farmer | herder
  lang TEXT NOT NULL DEFAULT 'ha', -- ha | en
  ward_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY,
  farmer_phone TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  crop TEXT NOT NULL,
  landmark TEXT NOT NULL,
  size TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'standing', -- standing | open | booked | harvested | closed
  expected_harvest TEXT,
  terms TEXT,                              -- free | manure | price
  price INTEGER,
  open_from TEXT,
  open_days INTEGER,
  rewarded_season TEXT,
  reminded_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS herder_routes (
  phone TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  PRIMARY KEY (phone, ward_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  field_id INTEGER NOT NULL,
  herder_phone TEXT NOT NULL,
  code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active | ended | completed | disputed
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  field_id INTEGER NOT NULL,
  booking_id INTEGER,
  reporter_phone TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',     -- open | resolved
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mediators (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT,
  ward_id INTEGER                          -- NULL = covers every ward
);

CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,                   -- sms | airtime | voice
  recipient TEXT NOT NULL,
  body TEXT,
  status TEXT,
  meta TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ussd_sessions (
  id TEXT PRIMARY KEY,
  offset INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voice_alerts (
  phone TEXT PRIMARY KEY,
  field_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function seedWards() {
  if (db.prepare('SELECT COUNT(*) n FROM wards').get().n) return;
  const wards = config.wards
    ? JSON.parse(config.wards)
    : JSON.parse(fs.readFileSync(new URL('./seed/wards.json', import.meta.url), 'utf8'));
  const ins = db.prepare('INSERT INTO wards (code, name, lga, lat, lng) VALUES (?, ?, ?, ?, ?)');
  for (const w of wards) ins.run(String(w.code), w.name, w.lga, w.lat ?? null, w.lng ?? null);
}
seedWards();

const FIELD_SELECT = `
  SELECT f.*, w.name AS ward_name, w.code AS ward_code, w.lga, w.lat, w.lng,
         u.name AS farmer_name, u.lang AS farmer_lang
  FROM fields f
  JOIN wards w ON w.id = f.ward_id
  LEFT JOIN users u ON u.phone = f.farmer_phone`;

export const getUser = (phone) => db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
export const getWard = (id) => db.prepare('SELECT * FROM wards WHERE id = ?').get(id);
export const wardByCode = (code) => db.prepare('SELECT * FROM wards WHERE code = ?').get(String(code || '').trim());
export const lgaNames = () => db.prepare('SELECT DISTINCT lga FROM wards ORDER BY lga').all().map((r) => r.lga);
export const wardsInLga = (lga) => db.prepare('SELECT * FROM wards WHERE lga = ? ORDER BY name').all(lga);
export const getField = (id) => db.prepare(`${FIELD_SELECT} WHERE f.id = ?`).get(id);
export const queryFields = (where, ...params) => db.prepare(`${FIELD_SELECT} WHERE ${where}`).all(...params);
export const getBooking = (id) => db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
