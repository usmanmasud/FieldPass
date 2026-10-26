// End-to-end season: farmer registers a field, opens the stalks, a herder
// books by USSD, the farmer confirms with the pass code, airtime goes out.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.REWARD_MIN_FIELD_AGE_DAYS = '0';
delete process.env.AT_API_KEY;

const { handleUssd } = await import('../src/ussd.js');
const { handleVoice } = await import('../src/voice.js');
const { handleSms } = await import('../src/sms.js');
const { db } = await import('../src/db.js');
const { runJobs } = await import('../src/jobs.js');

const FARMER = '+2348031110001';
const HERDER = '+2348031110002';
const HERDER2 = '08031110003';
const settle = () => new Promise((r) => setTimeout(r, 20));

// Drives one USSD session the way Africa's Talking does: text accumulates.
function dial(phone, inputs, sessionId = `s-${Math.random()}`) {
  let reply;
  for (let k = 0; k <= inputs.length; k++) {
    reply = handleUssd({ sessionId, phoneNumber: phone, text: inputs.slice(0, k).join('*') });
    if (k < inputs.length) assert.match(reply, /^CON /, `expected CON at step ${k}, got: ${reply}`);
  }
  return reply;
}

const sms = (phone) => db.prepare("SELECT body FROM messages WHERE channel = 'sms' AND recipient = ? ORDER BY id").all(phone).map((r) => r.body);

// LGA list is alphabetical: Bichi, Dawakin Tofa, Gezawa, ...; Dawakin Tofa wards: Dawakin Tofa, Dawanau
const DAWANAU = ['2', '2'];

test('farmer registers and continues to the menu in the same session', () => {
  const reply = dial(FARMER, ['2', '1', 'Sani', ...DAWANAU]);
  assert.match(reply, /^CON Welcome Sani!\n1\. Add a field/);
  // same session continues: 1 = add field
  const next = handleUssd({ sessionId: 'reg', phoneNumber: FARMER, text: '' });
  assert.match(next, /^CON FieldPass/);
});

test('herder registers in Hausa with route on home ward', () => {
  const reply = dial(HERDER, ['1', '2', 'Usman', ...DAWANAU]);
  assert.match(reply, /Barka Usman!/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM herder_routes WHERE phone = ?').get(HERDER).n, 1);
});

test('farmer adds a standing field, then opens the stalks', async () => {
  let reply = dial(FARMER, ['1', ...DAWANAU, '1', '2', '2', '2']);
  assert.match(reply, /^END Field #1 saved \(Sorghum, Dawanau\)/);
  assert.equal(db.prepare('SELECT status FROM fields WHERE id = 1').get().status, 'standing');

  reply = dial(FARMER, ['2', '1', '2', '2', '2', '1']); // field 1 -> open, manure swap, 1 week, today
  assert.match(reply, /^END Field #1 is open\. 1 herder\(s\) on this route alerted\. You will get N50 airtime\./);
  await settle();
  assert.match(sms(HERDER).at(-1), /Gona #1 a bude a Dawanau: karan Dawa, Musayar taki/);
});

test('herder sees avoid list empty and books via USSD', async () => {
  let reply = dial(HERDER, ['2', ...DAWANAU]);
  assert.match(reply, /^END Babu gonar da ba a girbe ba a Dawanau/);

  reply = dial(HERDER, ['1', ...DAWANAU, '1', '1']);
  const code = reply.match(/Lambar shiga (\d{4})/)?.[1];
  assert.ok(code, reply);
  await settle();
  assert.match(sms(FARMER).at(-1), new RegExp(`Usman .* booked field #1 .*Pass code ${code}`));

  // second herder can no longer see it
  reply = dial(HERDER2, ['2', '2', 'Bello', ...DAWANAU]);
  reply = dial(HERDER2, ['1', ...DAWANAU]);
  assert.match(reply, /^END No open fields in Dawanau/);
});

test('farmer confirms the herd left with no damage; both get airtime', async () => {
  const { code } = db.prepare('SELECT code FROM bookings WHERE id = 1').get();
  assert.match(dial(FARMER, ['3', '0000']), /not on any of your fields/);
  const reply = dial(FARMER, ['3', code, '1']);
  assert.match(reply, /Deal closed/);
  await settle();
  const airtime = db.prepare("SELECT recipient, body FROM messages WHERE channel = 'airtime' ORDER BY id").all();
  assert.deepEqual(airtime.map((a) => a.recipient), [FARMER, FARMER, HERDER]);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = 1').get().status, 'completed');
});

test('damage report alerts the mediator and the booked herder', async () => {
  db.prepare("INSERT INTO mediators (name, phone, role, ward_id) VALUES ('Ardo Bello', '+2348031119999', 'Ardo', NULL)").run();
  dial(FARMER, ['2', '1', '2', '1', '1', '1']); // reopen field 1: free, 3 days, today
  const booked = dial(HERDER, ['1', ...DAWANAU, '1', '1']);
  const code = booked.match(/(\d{4})/)[1];

  const reply = dial(FARMER, ['3', code, '2', '1', '2']);
  assert.match(reply, /^END Report INC-1 logged\. Ardo Bello alerted\./);
  await settle();
  assert.match(sms('+2348031119999').at(-1), /INC-1: .*field #1.*Herder on booking: Usman|INC-1: .*gona #1.*Makiyayi: Usman/);
  assert.match(sms(HERDER).at(-1), /INC-1/);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE code = ?').get(code).status, 'disputed');
});

test('voice IVR: ward summary and booking', async () => {
  dial(FARMER, ['1', ...DAWANAU, '3', '2', '1', '3']); // field 2 standing, in 2 weeks
  dial(FARMER, ['2', '1', '2', '3', '200', '2', '1']);  // field 1 open at N200/day

  const base = 'http://x';
  let xml = handleVoice({ isActive: '1', callerNumber: '+2348031110004', direction: 'Inbound' }, {}, base);
  assert.match(xml, /Enter your ward code/);
  xml = handleVoice({ isActive: '1', callerNumber: '+2348031110004', dtmfDigits: '101#' }, { step: 'ward' }, base);
  assert.match(xml, /1 field is open for grazing, and 1 still standing/);
  assert.match(xml, /200 naira per day/);
  const cb = new URL(xml.match(/callbackUrl="([^"]+)"/)[1].replace(/&amp;/g, '&'));
  xml = handleVoice({ isActive: '1', callerNumber: '+2348031110004', dtmfDigits: '1' }, Object.fromEntries(cb.searchParams), base);
  assert.match(xml, /Booked\. Your pass code is \d \d \d \d/);
  assert.equal(db.prepare("SELECT role FROM users WHERE phone = '+2348031110004'").get().role, 'herder');
});

test('SMS commands and jobs', async () => {
  handleSms({ from: HERDER, text: 'fields 999' });
  handleSms({ from: HERDER, text: 'FIELDS 101' });
  await settle();
  assert.match(sms(HERDER).at(-1), /Babu gona a bude a Dawanau/);

  db.prepare("UPDATE fields SET expected_harvest = date('now', '-1 day') WHERE id = 2").run();
  const r = runJobs();
  assert.equal(r.harvestReminders, 1);
  assert.equal(runJobs().harvestReminders, 0, 'no duplicate reminder');
});
