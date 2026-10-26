// Voice IVR for herders, who are often on the move, may not read, and rarely
// have data. They key in a ward code and hear what is open and what to avoid.
import { db, getWard, wardByCode } from './db.js';
import { normalizePhone, fmtSpoken } from './util.js';
import { name } from './i18n.js';
import * as svc from './services.js';

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const say = (text) => `<Say>${esc(text)}</Say>`;
const getDigits = (url, prompt, { numDigits, finishOnKey = '#', timeout = 20 } = {}) =>
  `<GetDigits timeout="${timeout}" finishOnKey="${finishOnKey}"${numDigits ? ` numDigits="${numDigits}"` : ''} callbackUrl="${esc(url)}">${say(prompt)}</GetDigits>`;

const spell = (digits) => String(digits).split('').join(' ');
const BYE = say('We did not hear anything. Goodbye.');

function spokenTerms(f) {
  if (f.terms === 'free') return 'free grazing';
  if (f.terms === 'manure') return 'in exchange for manure, the herd sleeps on the field';
  return `${f.price} naira per day`;
}

export function handleVoice(body, query, base) {
  if (body.isActive === '0') return ''; // end-of-call notification

  const url = (params) => `${base}/voice?${new URLSearchParams(params)}`;
  const caller = normalizePhone(body.callerNumber);
  const digits = String(body.dtmfDigits || '').replace(/[#*]/g, '');
  const askWard = (lead = '') =>
    xml(getDigits(url({ step: 'ward' }), `${lead}Enter your ward code, then press the hash key.`) + BYE);

  switch (query.step || 'start') {
    case 'start': {
      if (body.direction === 'Outbound') {
        const alert = svc.takeVoiceAlert([caller, normalizePhone(body.destinationNumber)]);
        if (alert?.field?.status === 'open') return alertCall(alert.field, url);
      }
      return askWard('Welcome to FieldPass. Sannu da zuwa. ');
    }
    case 'ward': {
      const ward = wardByCode(digits);
      if (!ward) {
        const codes = db.prepare('SELECT code, name FROM wards ORDER BY code LIMIT 12').all()
          .map((w) => `${spell(w.code)} for ${w.name}`).join(', ');
        return askWard(`Sorry, that ward code was not found. Codes are: ${codes}. `);
      }
      return wardSummary(ward, 0, url, true);
    }
    case 'field': {
      const ward = getWard(Number(query.ward));
      const i = Number(query.i) || 0;
      if (!ward) return askWard();
      if (digits === '1') {
        const field = svc.openFieldsInWard(ward.id)[i];
        return field ? book(field, caller, ward.id) : wardSummary(ward, 0, url, true);
      }
      if (digits === '2') return wardSummary(ward, i + 1, url, false);
      if (digits === '3') return askWard();
      return wardSummary(ward, i, url, false);
    }
    case 'alert': {
      const field = svc.openFieldsInWard(Number(query.ward)).find((f) => f.id === Number(query.field));
      if (digits === '1' && field) return book(field, caller, field.ward_id);
      return xml(say(digits === '1' ? 'Sorry, that field has already been booked. Goodbye.' : 'Thank you. Goodbye.'));
    }
    default:
      return askWard();
  }
}

function wardSummary(ward, i, url, intro) {
  const open = svc.openFieldsInWard(ward.id);
  const standing = svc.standingFieldsInWard(ward.id);
  let text = '';
  if (intro) {
    text += `In ${ward.name} ward, ${open.length} ${open.length === 1 ? 'field is' : 'fields are'} open for grazing, and ${standing.length} still standing. `;
    if (standing.length) {
      const near = [...new Set(standing.map((f) => name(f.landmark, 'en')))].slice(0, 3).join(', and near ');
      text += `Keep your herd away from standing crops near ${near}. The next harvest is expected around ${fmtSpoken(standing[0].expected_harvest)}. `;
    }
  }
  const options = 'Press 3 to choose another ward.';
  const f = open[i];
  if (!f) {
    text += open.length ? 'There are no more open fields here. ' : '';
    return xml(getDigits(url({ step: 'field', ward: ward.id, i: 0 }), `${text}${options}`, { numDigits: 1 }) + BYE);
  }
  text += `Field ${i + 1} of ${open.length}: ${name(f.crop, 'en').toLowerCase()} stalks near ${name(f.landmark, 'en')}, ${spokenTerms(f)}, `
    + `from ${fmtSpoken(f.open_from)} for ${f.open_days} days. Press 1 to book this field. `
    + `${i + 1 < open.length ? 'Press 2 for the next field. ' : ''}${options}`;
  return xml(getDigits(url({ step: 'field', ward: ward.id, i }), text, { numDigits: 1 }) + BYE);
}

function alertCall(field, url) {
  const text = `Hello from FieldPass. A field has just opened in ${field.ward_name} ward: ${name(field.crop, 'en').toLowerCase()} stalks `
    + `near ${name(field.landmark, 'en')}, ${spokenTerms(field)}, from ${fmtSpoken(field.open_from)}. Press 1 to book it now.`;
  return xml(getDigits(url({ step: 'alert', field: field.id, ward: field.ward_id }), text, { numDigits: 1 }) + BYE);
}

function book(field, caller, wardId) {
  svc.ensureHerder(caller, wardId);
  const r = svc.bookField(field.id, caller);
  if (r.error) return xml(say('Sorry, that field has just been booked by someone else. Please call again. Goodbye.'));
  const code = spell(r.booking.code);
  return xml(say(`Booked. Your pass code is ${code}. I repeat, ${code}. `
    + 'We have sent the code and the farmer\'s phone number to you by SMS. Show the code to the farmer when you arrive. Goodbye.'));
}
