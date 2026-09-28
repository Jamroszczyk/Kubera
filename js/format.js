// Formatting helpers. The account is USD. International quotes are converted before they get here;
// fmtNative shows the exchange price underneath.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export function fmtMoney(v, { sign = false, compact = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const s = compact && abs >= 100000 ? moneyCompact.format(abs) : money.format(abs);
  if (v < 0) return '-' + s;
  return sign && v > 0 ? '+' + s : s;
}

function priceDigits(v) {
  const abs = Math.abs(v);
  if (abs < 0.0001) return 8;
  if (abs < 0.01) return 6;
  if (abs < 1) return 4;
  // Forex and other sub-dollar-precision prices (1.1373) need more than cents.
  if (abs < 20) {
    const cents = Math.round(abs * 100) / 100;
    if (Math.abs(abs - cents) > abs * 1e-4) return 4;
  }
  return 2;
}

export function fmtPrice(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const digits = priceDigits(v);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v < 0 ? '-$' : '$') + s;
}

/** Exchange-local price, after minor units (GBp) have already been scaled. */
export function fmtNative(v, currency) {
  if (v == null || !currency || currency === 'USD') return '';
  const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch {
    return '';
  }
}

export function fmtPct(v, { sign = true } = {}) {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return '—';
  const p = (v * 100).toFixed(2);
  if (v > 0 && sign) return '+' + p + '%';
  return p + '%';
}

export function fmtNum(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return num2.format(v);
}

export function fmtQty(q) {
  if (q == null || Number.isNaN(q)) return '—';
  return qtyFmt.format(q);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateShort(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

/** Pick a time-label formatter suited to the span of a series (in ms). */
export function timeLabelFormatter(spanMs) {
  if (spanMs < 36 * 3_600_000) return fmtTime;
  if (spanMs < 8 * 86_400_000) return (ts) => fmtDate(ts) + ', ' + fmtTime(ts);
  if (spanMs < 300 * 86_400_000) return fmtDate;
  return fmtDateShort;
}

export function signClass(v) {
  if (v > 0) return 'pos';
  if (v < 0) return 'neg';
  return '';
}

export function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 15_000) return 'just now';
  if (diff < 60_000) return Math.round(diff / 1000) + 's ago';
  if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h ago';
  return fmtDate(ts);
}

export function round(v, digits = 6) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
