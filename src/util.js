import config from './config.js';

const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 1); // WAT

export const today = () => new Date(Date.now() + TZ_OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400e3);

// 2026-10-31 -> 31/10 (short enough for USSD screens)
export const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '-');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// 2026-10-31 -> 31 October (for text-to-speech)
export const fmtSpoken = (d) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : '');

export function normalizePhone(p) {
  let s = String(p || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^0\d{9,10}$/.test(s)) s = `+${config.countryCode}${s.slice(1)}`;
  if (!s.startsWith('+') && s.startsWith(config.countryCode)) s = `+${s}`;
  return s;
}

// +2348031234567 -> 08031234567
export const localPhone = (p) => (p && p.startsWith(`+${config.countryCode}`) ? `0${p.slice(config.countryCode.length + 1)}` : p || '');

export const maskPhone = (p) => {
  const l = localPhone(p);
  return l.length > 7 ? `${l.slice(0, 4)}***${l.slice(-4)}` : l;
};

export const money = (amount) => `${config.currency === 'NGN' ? 'N' : `${config.currency} `}${amount}`;
