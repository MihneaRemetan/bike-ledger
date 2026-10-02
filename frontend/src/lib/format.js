const km = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'RON', maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const fmtKm = (n) => (n == null ? '–' : `${km.format(n)} km`);
export const fmtMoney = (n) => (n == null ? '–' : money.format(n));
export const fmtDate = (s) => {
  if (!s) return '–';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? '–' : dateFmt.format(d);
};
export const fmtDuration = (min) =>
  min == null ? '–' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
export const fmtElev = (m) => (m == null ? '–' : `${m} m`);

export const todayStr = () => new Date().toISOString().slice(0, 10);
// "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">
export const toLocalInput = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
