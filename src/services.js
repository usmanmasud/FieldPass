// Business logic shared by the USSD, Voice and SMS channels.
// Database work is synchronous so USSD replies stay fast; outbound
// SMS / airtime / calls are fired in the background.
import config from './config.js';
import { db, getUser, getField, getWard, getBooking, queryFields } from './db.js';
import { today, addDays, daysBetween, fmtDate, localPhone, money } from './util.js';
import { t, name, termsText } from './i18n.js';
import * as at from './at.js';

const bg = (p) => Promise.resolve(p).catch((e) => console.error('[background]', e));
const season = () => today().slice(0, 4);
const langOf = (phone) => getUser(phone)?.lang || config.defaultLang;

// ---------- users ----------

export function createUser({ phone, name: userName, role, lang, wardId }) {
  db.prepare(`INSERT INTO users (phone, name, role, lang, ward_id) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(phone) DO UPDATE SET name = excluded.name, role = excluded.role,
              lang = excluded.lang, ward_id = excluded.ward_id`)
    .run(phone, userName, role, lang, wardId ?? null);
  if (role === 'herder' && wardId) addRoute(phone, wardId);
  return getUser(phone);
}

export function welcome(user) {
  const ward = getWard(user.ward_id);
  const vars = { name: user.name, ussd: config.ussdCode, code: ward?.code || '' };
  let msg = t(user.lang, user.role === 'herder' ? 'smsWelcomeHerder' : 'smsWelcomeFarmer', vars);
  if (user.role === 'herder' && config.at.voiceNumber) msg += t(user.lang, 'smsVoiceHint', { voice: localPhone(config.at.voiceNumber) });
  bg(at.sendSms(user.phone, msg));
}

// Callers who reach us by voice/SMS without registering become herders.
export function ensureHerder(phone, wardId) {
  return getUser(phone) || createUser({ phone, name: 'Herder', role: 'herder', lang: config.defaultLang, wardId });
}

export const setLang = (phone, lang) => db.prepare('UPDATE users SET lang = ? WHERE phone = ?').run(lang, phone);

export const addRoute = (phone, wardId) => db.prepare('INSERT OR IGNORE INTO herder_routes (phone, ward_id) VALUES (?, ?)').run(phone, wardId);
export const clearRoute = (phone) => db.prepare('DELETE FROM herder_routes WHERE phone = ?').run(phone);
export const routeWards = (phone) => db.prepare(
  'SELECT w.* FROM herder_routes r JOIN wards w ON w.id = r.ward_id WHERE r.phone = ? ORDER BY w.name').all(phone);

// ---------- fields ----------

export function addField({ farmerPhone, wardId, crop, landmark, size, harvestInDays }) {
  const r = db.prepare(`INSERT INTO fields (farmer_phone, ward_id, crop, landmark, size, status, expected_harvest)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(farmerPhone, wardId, crop, landmark, size, harvestInDays === 0 ? 'harvested' : 'standing', addDays(today(), harvestInDays));
  return getField(Number(r.lastInsertRowid));
}

export const farmerFields = (phone) => queryFields("f.farmer_phone = ? AND f.status <> 'closed' ORDER BY f.id", phone);
export const openFieldsInWard = (wardId) => queryFields("f.ward_id = ? AND f.status = 'open' ORDER BY f.open_from, f.id", wardId);
export const standingFieldsInWard = (wardId) => queryFields("f.ward_id = ? AND f.status = 'standing' ORDER BY f.expected_harvest", wardId);

export function markStanding(fieldId, harvestInDays) {
  db.prepare("UPDATE fields SET status = 'standing', expected_harvest = ?, reminded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(addDays(today(), harvestInDays), fieldId);
}

// Harvested but the farmer keeps the stalks (or closes the field for the season).
export function markHarvested(fieldId, closed = false) {
  const before = getField(fieldId);
  db.prepare('UPDATE fields SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(closed ? 'closed' : 'harvested', fieldId);
  return { reward: closed ? 0 : rewardHarvestUpdate(before) };
}

export function openField(fieldId, { terms, price, days, fromOffset }) {
  const before = getField(fieldId);
  db.prepare(`UPDATE fields SET status = 'open', terms = ?, price = ?, open_days = ?, open_from = ?,
              updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(terms, terms === 'price' ? price : null, days, addDays(today(), fromOffset), fieldId);
  const field = getField(fieldId);
  return { field, alerted: alertHerders(field), reward: rewardHarvestUpdate(before) };
}

// Airtime for a standing -> harvested update keeps the map honest. One reward
// per field per season, only for fields registered long enough ago.
function rewardHarvestUpdate(field) {
  const amount = config.rewards.statusUpdate;
  if (!amount || field.status !== 'standing' || field.rewarded_season === season()) return 0;
  if (daysBetween(field.created_at.slice(0, 10), today()) < config.rewards.minFieldAgeDays) return 0;
  db.prepare('UPDATE fields SET rewarded_season = ? WHERE id = ?').run(season(), field.id);
  bg(reward(field.farmer_phone, amount, `harvest update field #${field.id}`));
  return amount;
}

export function fieldVars(f, lang) {
  return {
    id: f.id,
    crop: name(f.crop, lang),
    landmark: name(f.landmark, lang),
    size: name(f.size, lang),
    ward: f.ward_name,
    terms: termsText(f, lang),
    from: fmtDate(f.open_from),
    days: f.open_days,
    ussd: config.ussdCode,
  };
}

export function alertHerders(field) {
  const herders = db.prepare(`SELECT u.* FROM herder_routes r JOIN users u ON u.phone = r.phone
                              WHERE r.ward_id = ? AND u.phone <> ?`).all(field.ward_id, field.farmer_phone);
  for (const h of herders) {
    bg(at.sendSms(h.phone, t(h.lang, 'smsFieldOpen', fieldVars(field, h.lang))));
    if (config.voiceAlerts) {
      db.prepare('INSERT OR REPLACE INTO voice_alerts (phone, field_id) VALUES (?, ?)').run(h.phone, field.id);
      bg(at.call(h.phone, `Voice alert: field #${field.id} open in ${field.ward_name}`));
    }
  }
  return herders.length;
}

export function takeVoiceAlert(phones) {
  for (const phone of phones.filter(Boolean)) {
    const row = db.prepare('SELECT * FROM voice_alerts WHERE phone = ?').get(phone);
    if (row) {
      db.prepare('DELETE FROM voice_alerts WHERE phone = ?').run(phone);
      return { phone, field: getField(row.field_id) };
    }
  }
  return null;
}

// ---------- bookings ----------

function newCode() {
  for (;;) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!db.prepare("SELECT 1 FROM bookings WHERE code = ? AND status IN ('active', 'ended')").get(code)) return code;
  }
}

export function bookField(fieldId, herderPhone) {
  const field = getField(fieldId);
  if (!field || field.farmer_phone === herderPhone) return { error: 'taken' };
  // Conditional update makes the booking atomic: two herders can't win the same field.
  const claimed = db.prepare("UPDATE fields SET status = 'booked', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'").run(fieldId);
  if (!claimed.changes) return { error: 'taken' };

  const start = field.open_from > today() ? field.open_from : today();
  const end = addDays(start, field.open_days || 7);
  const code = newCode();
  const r = db.prepare('INSERT INTO bookings (field_id, herder_phone, code, start_date, end_date) VALUES (?, ?, ?, ?, ?)')
    .run(fieldId, herderPhone, code, start, end);
  const booking = getBooking(Number(r.lastInsertRowid));

  const herder = getUser(herderPhone) || { name: 'Herder', lang: config.defaultLang };
  const farmerLang = field.farmer_lang || config.defaultLang;
  const common = { code, from: fmtDate(start), to: fmtDate(end) };
  bg(at.sendSms(herderPhone, t(herder.lang, 'smsHerderBooked', {
    ...fieldVars(field, herder.lang), ...common, farmer: field.farmer_name, phone: localPhone(field.farmer_phone),
  })));
  bg(at.sendSms(field.farmer_phone, t(farmerLang, 'smsFarmerBooked', {
    ...fieldVars(field, farmerLang), ...common, herder: herder.name, phone: localPhone(herderPhone),
  })));
  return { booking, field };
}

export function findFarmerBooking(farmerPhone, code) {
  return db.prepare(`SELECT b.* FROM bookings b JOIN fields f ON f.id = b.field_id
                     WHERE b.code = ? AND f.farmer_phone = ? AND b.status IN ('active', 'ended')`)
    .get(String(code || '').trim(), farmerPhone);
}

export function farmerBookings(phone) {
  return db.prepare(`SELECT b.*, u.name AS herder_name FROM bookings b
                     JOIN fields f ON f.id = b.field_id LEFT JOIN users u ON u.phone = b.herder_phone
                     WHERE f.farmer_phone = ? AND b.status IN ('active', 'ended') ORDER BY b.end_date`).all(phone);
}

export function herderBookings(phone) {
  return db.prepare(`SELECT b.*, w.name AS ward_name FROM bookings b
                     JOIN fields f ON f.id = b.field_id JOIN wards w ON w.id = f.ward_id
                     WHERE b.herder_phone = ? AND b.status IN ('active', 'ended') ORDER BY b.end_date`).all(phone);
}

// Farmer confirms the herd left with no damage: close the deal and reward both sides.
export function completeBooking(bookingId) {
  const booking = getBooking(bookingId);
  db.prepare("UPDATE bookings SET status = 'completed', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(bookingId);
  db.prepare("UPDATE fields SET status = 'harvested', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(booking.field_id);
  const field = getField(booking.field_id);
  const amount = config.rewards.completion;
  for (const phone of [field.farmer_phone, booking.herder_phone]) {
    const lang = langOf(phone);
    if (amount) bg(reward(phone, amount, `peaceful deal booking #${booking.id}`));
    bg(at.sendSms(phone, t(lang, 'smsThanks', {
      id: field.id, reward: amount ? t(lang, 'smsThanksReward', { amt: money(amount) }) : '',
    })));
  }
  return { amount };
}

// ---------- incidents ----------

export function reportIncident({ fieldId, reporterPhone, kind, daysAgo = 0, bookingId }) {
  const field = getField(fieldId);
  const booking = bookingId
    ? getBooking(bookingId)
    : db.prepare("SELECT * FROM bookings WHERE field_id = ? AND status IN ('active', 'ended') ORDER BY id DESC LIMIT 1").get(fieldId);
  const occurred = addDays(today(), -daysAgo);
  const r = db.prepare('INSERT INTO incidents (field_id, booking_id, reporter_phone, kind, occurred_on) VALUES (?, ?, ?, ?, ?)')
    .run(fieldId, booking?.id ?? null, reporterPhone, kind, occurred);
  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(Number(r.lastInsertRowid));

  if (booking) {
    db.prepare("UPDATE bookings SET status = 'disputed', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(booking.id);
    db.prepare("UPDATE fields SET status = 'harvested', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'booked'").run(fieldId);
  }

  const mediators = db.prepare('SELECT * FROM mediators WHERE ward_id IS NULL OR ward_id = ? ORDER BY ward_id DESC').all(field.ward_id);
  const herder = booking ? getUser(booking.herder_phone) || { name: 'Herder', phone: booking.herder_phone } : null;
  for (const m of mediators) {
    const lang = config.defaultLang;
    bg(at.sendSms(m.phone, t(lang, 'smsIncident', {
      ...fieldVars(field, lang),
      inc: incident.id,
      kind: name(kind, lang),
      when: fmtDate(occurred),
      farmer: field.farmer_name,
      phone: localPhone(field.farmer_phone),
      herder: herder ? t(lang, 'smsIncidentHerder', { name: herder.name, phone: localPhone(booking.herder_phone) }) : '',
    })));
  }
  if (booking) {
    bg(at.sendSms(booking.herder_phone, t(langOf(booking.herder_phone), 'smsIncidentToHerder', { inc: incident.id, id: fieldId })));
  }
  return { incident, mediators };
}

// ---------- airtime ----------

export async function reward(phone, amount, reason) {
  const spent = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM rewards
                            WHERE phone = ? AND date(created_at) = date('now') AND status IN ('sent', 'dry-run', 'pending')`).get(phone).s;
  if (spent + amount > config.rewards.dailyCap) {
    db.prepare("INSERT INTO rewards (phone, amount, reason, status) VALUES (?, ?, ?, 'capped')").run(phone, amount, reason);
    return 'capped';
  }
  const r = db.prepare("INSERT INTO rewards (phone, amount, reason, status) VALUES (?, ?, ?, 'pending')").run(phone, amount, reason);
  const status = await at.sendAirtime(phone, amount);
  db.prepare('UPDATE rewards SET status = ? WHERE id = ?').run(status, Number(r.lastInsertRowid));
  return status;
}
