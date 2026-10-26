// Inbound SMS commands (needs a shortcode / keyword on Africa's Talking):
//   FIELDS <ward code>   list open fields     BOOK <field no>   book a field
//   DONE <code>          farmer confirms the herd left with no damage
import config from './config.js';
import { getUser, getField, db, wardByCode } from './db.js';
import { normalizePhone, fmtDate } from './util.js';
import { t, name, termsText } from './i18n.js';
import * as svc from './services.js';
import * as at from './at.js';

export function handleSms({ from, text }) {
  const phone = normalizePhone(from);
  const [cmd = '', arg = ''] = String(text || '').trim().split(/\s+/);
  const user = getUser(phone);
  const lang = user?.lang || config.defaultLang;
  const reply = (key, vars) => at.sendSms(phone, t(lang, key, { ussd: config.ussdCode, ...vars }));

  switch (cmd.toUpperCase()) {
    case 'FIELDS':
    case 'OPEN': {
      const ward = wardByCode(arg);
      if (!ward) {
        const codes = db.prepare('SELECT code, name FROM wards ORDER BY code').all().map((w) => `${w.code} ${w.name}`).join(', ');
        return reply('smsNoWard', { codes });
      }
      const open = svc.openFieldsInWard(ward.id);
      if (!open.length) return reply('noneOpen', { ward: ward.name, standing: svc.standingFieldsInWard(ward.id).length });
      const list = open.slice(0, 5).map((f) => `#${f.id} ${name(f.crop, lang)} ${termsText(f, lang)} ${fmtDate(f.open_from)}`).join('; ');
      return reply('smsFieldsList', { ward: ward.name, list });
    }
    case 'BOOK': {
      const field = getField(Number(arg));
      if (field?.status !== 'open') return reply('fieldTaken');
      svc.ensureHerder(phone, field.ward_id);
      if (svc.bookField(field.id, phone).error) return reply('fieldTaken');
      return; // both sides already got booking SMS
    }
    case 'DONE': {
      const b = svc.findFarmerBooking(phone, arg);
      if (!b) return reply('codeNotFound');
      svc.completeBooking(b.id);
      return;
    }
    default:
      return reply('smsHelp');
  }
}
