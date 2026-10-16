const NY = 'America/New_York';
export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;
export const NO_TAKE_AFTER = 15 * 60 + 30;
export const NO_TAKE_BEFORE = 10 * 60 + 30;
export const FLATTEN_MIN = 15 * 60 + 45;

export function nyDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: NY });
}

export function nyTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
}

export function nyDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { timeZone: NY, month: 'short', day: 'numeric' })
    + ' '
    + d.toLocaleTimeString('en-US', { timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function nyWeekday(ts) {
  return new Date(ts).toLocaleDateString('en-US', { timeZone: NY, weekday: 'short' });
}

const minsCache = new Map();
export function nyMins(ts) {
  let m = minsCache.get(ts);
  if (m != null) return m;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  m = Number(map.hour) * 60 + Number(map.minute);
  minsCache.set(ts, m);
  return m;
}

export function sessionDays(ts) {
  const days = [];
  let cur = null;
  for (let i = 0; i < ts.length; i++) {
    const key = nyDate(ts[i]);
    const wd = nyWeekday(ts[i]);
    if (wd === 'Sat' || wd === 'Sun') continue;
    if (!cur || cur.key !== key) {
      cur = {
        key, weekday: wd,
        label: new Date(ts[i]).toLocaleDateString('en-US', { timeZone: NY, weekday: 'short', month: 'short', day: 'numeric' }),
        from: i, to: i + 1,
      };
      days.push(cur);
    } else {
      cur.to = i + 1;
    }
  }
  return days;
}

export function lastMonFri(ts) {
  const days = sessionDays(ts);
  let fri = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].weekday === 'Fri') { fri = i; break; }
  }
  if (fri < 0) return [];
  const week = [];
  for (let i = fri; i >= 0 && week.length < 5; i--) {
    week.unshift(days[i]);
    if (days[i].weekday === 'Mon') break;
  }
  return week.filter((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(d.weekday));
}

export function discoveryCut(ts, T) {
  const days = sessionDays(ts);
  if (days.length < 4) return Math.max(80, Math.floor(T * 0.7));
  const nDisc = Math.min(days.length - 2, Math.max(3, Math.floor(days.length * 0.45)));
  return days[nDisc - 1].to;
}
