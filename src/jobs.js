// Periodic nudges that keep the field map honest.
import config from './config.js';
import { db, queryFields } from './db.js';
import { today, addDays } from './util.js';
import { t, name } from './i18n.js';
import * as at from './at.js';

export function runJobs() {
  const now = today();
  const result = { harvestReminders: 0, bookingsEnded: 0, listingsExpired: 0 };

  // 1. Fields past their expected harvest date: ask the farmer to update.
  const due = queryFields(`f.status = 'standing' AND f.expected_harvest <= ?
                           AND (f.reminded_at IS NULL OR f.reminded_at <= ?)`, now, addDays(now, -3));
  for (const f of due) {
    const lang = f.farmer_lang || config.defaultLang;
    at.sendSms(f.farmer_phone, t(lang, 'smsHarvestReminder', { id: f.id, crop: name(f.crop, lang), ussd: config.ussdCode }));
    db.prepare('UPDATE fields SET reminded_at = ? WHERE id = ?').run(now, f.id);
    result.harvestReminders++;
  }

  // 2. Bookings past their end date: ask the farmer to confirm with the code.
  const ended = db.prepare(`SELECT b.*, f.farmer_phone, u.lang FROM bookings b JOIN fields f ON f.id = b.field_id
                            LEFT JOIN users u ON u.phone = f.farmer_phone
                            WHERE b.status = 'active' AND b.end_date < ?`).all(now);
  for (const b of ended) {
    db.prepare("UPDATE bookings SET status = 'ended' WHERE id = ?").run(b.id);
    at.sendSms(b.farmer_phone, t(b.lang || config.defaultLang, 'smsBookingEnded', { code: b.code, id: b.field_id, ussd: config.ussdCode }));
    result.bookingsEnded++;
  }

  // 3. Open listings whose window has passed are no longer offered.
  result.listingsExpired = Number(db.prepare(`UPDATE fields SET status = 'harvested', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'open' AND date(open_from, '+' || open_days || ' days') < ?`).run(now).changes);

  return result;
}

export function startJobs() {
  const tick = () => {
    try {
      runJobs();
    } catch (e) {
      console.error('[jobs]', e);
    }
  };
  setTimeout(tick, 10_000);
  return setInterval(tick, 60 * 60 * 1000);
}
