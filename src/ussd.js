// USSD menus for farmers and herders.
//
// Africa's Talking sends the whole input history as `text` ("1*2*Musa*3").
// A Session walks through those inputs; when it runs out, `ask` throws a
// Halt carrying the next CON screen, and every flow ends with an END screen.
import config from './config.js';
import { db, getUser, lgaNames, wardsInLga } from './db.js';
import { normalizePhone, fmtDate, localPhone, money } from './util.js';
import { t, name, termsText, CROPS, LANDMARKS, SIZES, DAMAGE_KINDS } from './i18n.js';
import * as svc from './services.js';

const PAGE = 6;

class Halt {
  constructor(text) {
    this.text = text;
  }
}

class Session {
  constructor(parts, lang, offset = 0) {
    this.parts = parts;
    this.lang = lang;
    this.i = offset;
  }

  t(key, vars) {
    return t(this.lang, key, vars);
  }

  ask(prompt) {
    if (this.i >= this.parts.length) throw new Halt(`CON ${prompt}`);
    return this.parts[this.i++].trim();
  }

  end(text) {
    throw new Halt(`END ${text}`);
  }

  choose(prompt, n) {
    const k = Number(this.ask(prompt));
    if (!Number.isInteger(k) || k < 1 || k > n) this.end(this.t('invalid'));
    return k;
  }

  // Numbered list with "98. More" paging.
  pick(title, items, label) {
    for (let page = 0; ; page++) {
      const slice = items.slice(page * PAGE, (page + 1) * PAGE);
      const more = items.length > (page + 1) * PAGE;
      const lines = [title, ...slice.map((it, k) => `${k + 1}. ${label(it)}`)];
      if (more) lines.push(this.t('more'));
      const v = this.ask(lines.join('\n'));
      if (v === '98' && more) continue;
      const k = Number(v);
      if (Number.isInteger(k) && k >= 1 && k <= slice.length) return slice[k - 1];
      this.end(this.t('invalid'));
    }
  }

  pickWard() {
    const lgas = lgaNames();
    const lga = lgas.length === 1 ? lgas[0] : this.pick(this.t('pickLga'), lgas, (l) => l);
    const wards = wardsInLga(lga);
    return wards.length === 1 ? wards[0] : this.pick(this.t('pickWard'), wards, (w) => w.name);
  }
}

export function handleUssd({ sessionId = '', phoneNumber = '', text = '' }) {
  const phone = normalizePhone(phoneNumber);
  const parts = text === '' ? [] : String(text).split('*');
  try {
    const user = getUser(phone);
    if (!user) return register(new Session(parts, config.defaultLang), phone, sessionId);
    const sess = db.prepare('SELECT offset FROM ussd_sessions WHERE id = ?').get(sessionId);
    const s = new Session(parts, user.lang, sess?.offset ?? 0);
    return user.role === 'herder' ? herderMenu(s, user) : farmerMenu(s, user);
  } catch (e) {
    if (e instanceof Halt) return e.text;
    console.error('[ussd]', e);
    return 'END Service temporarily unavailable. Please try again.';
  }
}

function register(s, phone, sessionId) {
  s.lang = s.choose(t('en', 'welcome'), 2) === 1 ? 'ha' : 'en';
  const role = s.choose(s.t('chooseRole'), 2) === 1 ? 'farmer' : 'herder';
  const userName = s.ask(s.t('askName')).slice(0, 30);
  if (!userName) s.end(s.t('invalid'));
  const ward = s.pickWard();
  const user = svc.createUser({ phone, name: userName, role, lang: s.lang, wardId: ward.id });
  svc.welcome(user);
  // Later inputs in this same session belong to the main menu, not registration.
  db.prepare('INSERT OR REPLACE INTO ussd_sessions (id, offset) VALUES (?, ?)').run(sessionId, s.i);
  const menu = s.t(role === 'herder' ? 'herderMenu' : 'farmerMenu').replace(/^FieldPass\n/, '');
  throw new Halt(`CON ${s.t('registered', { name: userName })}\n${menu}`);
}

// ---------- farmer ----------

function farmerMenu(s, user) {
  switch (s.choose(s.t('farmerMenu'), 6)) {
    case 1: return addField(s, user);
    case 2: return updateField(s, user);
    case 3: return confirmHerdLeft(s, user);
    case 4: return reportDamage(s, user);
    case 5: return listBookings(s, svc.farmerBookings(user.phone), (b) => `#${b.field_id} ${b.code} ${b.herder_name || localPhone(b.herder_phone)} -${fmtDate(b.end_date)}`);
    default: return switchLang(s, user);
  }
}

const fieldLabel = (f, lang) => `#${f.id} ${name(f.crop, lang)}, ${f.ward_name}`;

function addField(s, user) {
  const ward = s.pickWard();
  const crop = s.pick(s.t('pickCrop'), CROPS, (c) => name(c, s.lang));
  const landmark = s.pick(s.t('pickLandmark'), LANDMARKS, (l) => name(l, s.lang));
  const size = SIZES[s.choose(s.t('pickSize'), 3) - 1];
  const harvestInDays = [0, 3, 14, 25, 45][s.choose(s.t('pickHarvest'), 5) - 1];
  const f = svc.addField({ farmerPhone: user.phone, wardId: ward.id, crop, landmark, size, harvestInDays });
  s.end(s.t('fieldSaved', { id: f.id, crop: name(crop, s.lang), ward: ward.name }));
}

function updateField(s, user) {
  const fields = svc.farmerFields(user.phone);
  if (!fields.length) s.end(s.t('noFields'));
  const f = s.pick(s.t('pickField'), fields, (x) => fieldLabel(x, s.lang));
  if (f.status === 'booked') {
    const b = db.prepare("SELECT * FROM bookings WHERE field_id = ? AND status = 'active' ORDER BY id DESC").get(f.id);
    s.end(s.t('fieldBooked', { id: f.id, to: fmtDate(b?.end_date), code: b?.code || '-' }));
  }
  const rewardNote = (amt) => (amt ? s.t('rewardNote', { amt: money(amt) }) : '');

  switch (s.choose(s.t('statusMenu', { id: f.id }), 4)) {
    case 1: {
      svc.markStanding(f.id, [3, 14, 25, 45][s.choose(s.t('pickHarvestStanding'), 4) - 1]);
      return s.end(s.t('statusSaved', { id: f.id }));
    }
    case 2: {
      const terms = ['free', 'manure', 'price'][s.choose(s.t('pickTerms'), 3) - 1];
      let price = null;
      if (terms === 'price') {
        price = Number.parseInt(s.ask(s.t('enterPrice')), 10);
        if (!(price > 0)) s.end(s.t('invalid'));
      }
      const days = [3, 7, 14, 30][s.choose(s.t('pickDays'), 4) - 1];
      const fromOffset = [0, 1, 3][s.choose(s.t('pickFrom'), 3) - 1];
      const r = svc.openField(f.id, { terms, price, days, fromOffset });
      return s.end(s.t('opened', { id: f.id, n: r.alerted }) + rewardNote(r.reward));
    }
    case 3: {
      const r = svc.markHarvested(f.id);
      return s.end(s.t('statusSaved', { id: f.id }) + rewardNote(r.reward));
    }
    default:
      svc.markHarvested(f.id, true);
      return s.end(s.t('statusSaved', { id: f.id }));
  }
}

function confirmHerdLeft(s, user) {
  const b = svc.findFarmerBooking(user.phone, s.ask(s.t('enterCode')));
  if (!b) s.end(s.t('codeNotFound'));
  const herder = getUser(b.herder_phone);
  const ok = s.choose(s.t('anyDamage', { herder: herder?.name || localPhone(b.herder_phone), id: b.field_id }), 2) === 1;
  if (ok) {
    const { amount } = svc.completeBooking(b.id);
    s.end(amount ? s.t('completed', { amt: money(amount) }) : s.t('completedNoReward'));
  }
  damageDetails(s, user, b.field_id, b.id);
}

function reportDamage(s, user) {
  const fields = svc.farmerFields(user.phone);
  if (!fields.length) s.end(s.t('noFields'));
  const f = s.pick(s.t('pickField'), fields, (x) => fieldLabel(x, s.lang));
  damageDetails(s, user, f.id);
}

function damageDetails(s, user, fieldId, bookingId) {
  const daysAgo = [0, 1, 4][s.choose(s.t('pickWhen'), 3) - 1];
  const kind = DAMAGE_KINDS[s.choose(s.t('pickDamage'), 4) - 1];
  const r = svc.reportIncident({ fieldId, reporterPhone: user.phone, kind, daysAgo, bookingId });
  const who = r.mediators.length ? r.mediators.map((m) => m.name).join(', ') : s.t('noMediator');
  s.end(s.t('reported', { id: r.incident.id, mediators: who }));
}

// ---------- herder ----------

function herderMenu(s, user) {
  switch (s.choose(s.t('herderMenu'), 5)) {
    case 1: return findOpenFields(s, user);
    case 2: return fieldsToAvoid(s);
    case 3: return listBookings(s, svc.herderBookings(user.phone), (b) => `#${b.field_id} ${b.ward_name} ${b.code} -${fmtDate(b.end_date)}`);
    case 4: return routeAlerts(s, user);
    default: return switchLang(s, user);
  }
}

function findOpenFields(s, user) {
  const ward = s.pickWard();
  const open = svc.openFieldsInWard(ward.id);
  if (!open.length) {
    s.end(s.t('noneOpen', { ward: ward.name, standing: svc.standingFieldsInWard(ward.id).length }));
  }
  const f = s.pick(s.t('openTitle', { ward: ward.name }), open,
    (x) => `#${x.id} ${name(x.crop, s.lang)}, ${termsText(x, s.lang)}, ${fmtDate(x.open_from)}`);
  if (s.choose(s.t('fieldDetail', svc.fieldVars(f, s.lang)), 2) === 2) s.end(s.t('cancelled'));
  const r = svc.bookField(f.id, user.phone);
  if (r.error) s.end(s.t('fieldTaken'));
  s.end(s.t('booked', { code: r.booking.code, farmer: f.farmer_name, phone: localPhone(f.farmer_phone) }));
}

function fieldsToAvoid(s) {
  const ward = s.pickWard();
  const standing = svc.standingFieldsInWard(ward.id);
  if (!standing.length) s.end(s.t('avoidNone', { ward: ward.name }));
  const list = standing.slice(0, 2) // keeps the screen under the 182-char USSD limit
    .map((f) => s.t('avoidLine', { landmark: name(f.landmark, s.lang), crop: name(f.crop, s.lang), date: fmtDate(f.expected_harvest) }))
    .join('\n');
  s.end(s.t('avoidList', { ward: ward.name, list }));
}

function routeAlerts(s, user) {
  const current = svc.routeWards(user.phone).map((w) => w.name).join(', ') || '-';
  if (s.choose(s.t('routeMenu', { wards: current }), 2) === 2) {
    svc.clearRoute(user.phone);
    s.end(s.t('routeCleared'));
  }
  const ward = s.pickWard();
  svc.addRoute(user.phone, ward.id);
  s.end(s.t('routeAdded', { ward: ward.name }));
}

// ---------- shared ----------

function listBookings(s, bookings, line) {
  s.end(bookings.length ? bookings.slice(0, 5).map(line).join('\n') : s.t('noBookings'));
}

function switchLang(s, user) {
  const lang = user.lang === 'ha' ? 'en' : 'ha';
  svc.setLang(user.phone, lang);
  s.end(t(lang, 'langChanged'));
}
