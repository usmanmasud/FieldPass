// Sample season data so the dashboard tells a story during a demo.
// Phone numbers are fictional (+234800000xxxx).
import { db, wardByCode } from '../db.js';
import { today, addDays } from '../util.js';

export function seedDemo() {
  if (db.prepare("SELECT 1 FROM users WHERE phone = '+2348000000101'").get()) return { seeded: false };
  const ward = (code) => wardByCode(code).id;
  const d = (n) => addDays(today(), n);

  const users = [
    ['+2348000000101', 'Malam Sani', 'farmer', 'ha', '101'],
    ['+2348000000102', 'Hajiya Binta', 'farmer', 'en', '103'],
    ['+2348000000103', 'Audu Garba', 'farmer', 'ha', '104'],
    ['+2348000000104', 'Lawan Kura', 'farmer', 'ha', '108'],
    ['+2348000000105', 'Rabi Yusuf', 'farmer', 'ha', '102'],
    ['+2348000000201', 'Usman Jafaru', 'herder', 'ha', '101'],
    ['+2348000000202', 'Hamma Buba', 'herder', 'ha', '103'],
    ['+2348000000203', 'Sule Abdullahi', 'herder', 'ha', '108'],
  ];
  const insUser = db.prepare("INSERT INTO users (phone, name, role, lang, ward_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', '-20 days'))");
  for (const [phone, n, role, lang, code] of users) insUser.run(phone, n, role, lang, ward(code));

  const routes = { '+2348000000201': ['101', '102', '105'], '+2348000000202': ['103', '104', '107'], '+2348000000203': ['108', '109', '110'] };
  const insRoute = db.prepare('INSERT OR IGNORE INTO herder_routes (phone, ward_id) VALUES (?, ?)');
  for (const [phone, codes] of Object.entries(routes)) for (const c of codes) insRoute.run(phone, ward(c));

  // [farmer, ward, crop, landmark, size, status, expected_harvest, terms, price, open_from, open_days]
  const fields = [
    ['101', '101', 'sorghum', 'river', 'medium', 'standing', d(6), null, null, null, null],
    ['101', '101', 'millet', 'road', 'small', 'open', d(-10), 'manure', null, d(0), 7],
    ['105', '102', 'maize', 'school', 'medium', 'standing', d(12), null, null, null, null],
    ['105', '102', 'groundnut', 'village', 'small', 'open', d(-6), 'price', 500, d(1), 14],
    ['102', '103', 'sorghum', 'road', 'large', 'booked', d(-14), 'free', null, d(-3), 14],
    ['102', '103', 'cowpea', 'market', 'small', 'standing', d(4), null, null, null, null],
    ['103', '104', 'millet', 'dam', 'medium', 'harvested', d(-20), 'manure', null, d(-18), 7],
    ['103', '104', 'sorghum', 'river', 'medium', 'standing', d(9), null, null, null, null],
    ['104', '108', 'rice', 'dam', 'large', 'standing', d(18), null, null, null, null],
    ['104', '108', 'maize', 'road', 'medium', 'open', d(-8), 'free', null, d(0), 7],
    ['101', '105', 'sorghum', 'market', 'medium', 'harvested', d(-25), 'free', null, d(-22), 7],
  ];
  const insField = db.prepare(`INSERT INTO fields (farmer_phone, ward_id, crop, landmark, size, status, expected_harvest, terms, price,
                               open_from, open_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-30 days'))`);
  const ids = fields.map(([f, w, ...rest]) => Number(insField.run(`+2348000000${f}`, ward(w), ...rest).lastInsertRowid));

  const insBooking = db.prepare(`INSERT INTO bookings (field_id, herder_phone, code, start_date, end_date, status, closed_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insBooking.run(ids[4], '+2348000000202', '4821', d(-3), d(11), 'active', null);
  insBooking.run(ids[6], '+2348000000202', '7310', d(-18), d(-11), 'completed', `${d(-10)} 17:20:00`);
  const disputed = Number(insBooking.run(ids[10], '+2348000000201', '5592', d(-22), d(-15), 'disputed', `${d(-16)} 09:05:00`).lastInsertRowid);

  const insIncident = db.prepare('INSERT INTO incidents (field_id, booking_id, reporter_phone, kind, occurred_on, status) VALUES (?, ?, ?, ?, ?, ?)');
  insIncident.run(ids[0], null, '+2348000000101', 'standing_crop', d(-2), 'open');
  insIncident.run(ids[8], null, '+2348000000104', 'standing_crop', d(-5), 'open');
  insIncident.run(ids[10], disputed, '+2348000000101', 'during_booking', d(-16), 'resolved');

  const insMediator = db.prepare('INSERT INTO mediators (name, phone, role, ward_id) VALUES (?, ?, ?, ?)');
  insMediator.run('Ardo Muhammadu', '+2348000000301', 'Ardo (Fulani leader)', null);
  insMediator.run('Dagacin Dawanau', '+2348000000302', 'Village head', ward('101'));
  insMediator.run('Malam Idris (ADP)', '+2348000000303', 'Ward agric officer', ward('103'));

  const insReward = db.prepare("INSERT INTO rewards (phone, amount, reason, status, created_at) VALUES (?, ?, ?, 'dry-run', datetime('now', ?))");
  insReward.run('+2348000000103', 50, `harvest update field #${ids[6]}`, '-19 days');
  insReward.run('+2348000000103', 100, 'peaceful deal booking #2', '-10 days');
  insReward.run('+2348000000202', 100, 'peaceful deal booking #2', '-10 days');
  insReward.run('+2348000000101', 50, `harvest update field #${ids[1]}`, '-1 days');

  return { seeded: true };
}
