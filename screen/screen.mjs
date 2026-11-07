// Midas status screen for the Pi's 3.5" SPI LCD (ILI9486, /dev/fb0, 480x320 RGB565, touch ADS7846).
// Draws straight into the framebuffer with the Pi's console fonts; no extra packages.
// Pages (tap to switch): Book (equity, today, live P&L, holdings, shadows), Chart (QQQ today vs the noise band,
// with the bot's entries/exits), Trades (the main desk's trades today). Data: the trading server on localhost.
// MIDAS_FLIP=1 (default) turns the picture 180 degrees so the Pi can stand with its power cable on top.
// Run by systemd unit midas-screen (deploy/pi/system/midas-screen.service).
import fs from 'node:fs';
import zlib from 'node:zlib';

const FB = process.env.MIDAS_FB || '/dev/fb0';
const W = 480, H = 320;
const API = 'http://localhost:3000';
const EVERY = 30_000;
const FLIP = (process.env.MIDAS_FLIP ?? '1') === '1';
const PAGES = 3;

// ── fonts (PSF1 and PSF2 with unicode tables) ──
function loadFont(name) {
  const b = zlib.gunzipSync(fs.readFileSync(`/usr/share/consolefonts/${name}.psf.gz`));
  let glyphs, n, w, h, size, table, uni;
  if (b.readUInt16LE(0) === 0x0436) {                 // PSF1: width 8
    const mode = b[2]; h = b[3]; w = 8; size = h; n = mode & 1 ? 512 : 256; glyphs = 4; uni = mode & 2;
    table = glyphs + n * size;
  } else {                                            // PSF2
    const hs = b.readUInt32LE(8); uni = b.readUInt32LE(12) & 1;
    n = b.readUInt32LE(16); size = b.readUInt32LE(20); h = b.readUInt32LE(24); w = b.readUInt32LE(28);
    glyphs = hs; table = hs + n * size;
  }
  const map = new Map();
  if (uni) {
    let g = 0, i = table;
    const psf1 = b.readUInt16LE(0) === 0x0436;
    while (g < n && i < b.length) {
      if (psf1) {
        const c = b.readUInt16LE(i); i += 2;
        if (c === 0xffff) { g++; continue; }
        if (c !== 0xfffe && !map.has(c)) map.set(c, g);
      } else {
        const c = b[i];
        if (c === 0xff) { g++; i++; continue; }
        if (c === 0xfe) { i++; continue; }
        const len = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
        const cp = b.toString('utf8', i, i + len).codePointAt(0); i += len;
        if (!map.has(cp)) map.set(cp, g);
      }
    }
  }
  const row = Math.ceil(w / 8);
  return { w, h, glyph: (ch) => { const g = map.has(ch) ? map.get(ch) : ch < n ? ch : 63; return b.subarray(glyphs + g * size, glyphs + g * size + h * row); }, row };
}

const SMALL = loadFont('Lat15-TerminusBold16');      // 8x16 -> 60 columns
const MID = loadFont('Lat15-TerminusBold24x12');     // 12x24 -> 40 columns
const BIG = loadFont('Lat15-TerminusBold32x16');     // 16x32

// ── drawing ──
const rgb = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const C = { bg: rgb(8, 10, 16), fg: rgb(225, 228, 235), dim: rgb(120, 128, 140), green: rgb(60, 205, 110),
  red: rgb(240, 80, 80), amber: rgb(240, 180, 50), blue: rgb(70, 130, 230), bar: rgb(28, 32, 44) };
const buf = Buffer.alloc(W * H * 2);

function rect(x, y, w, h, c) {
  for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) buf.writeUInt16LE(c, (j * W + i) * 2);
}

function text(f, x, y, s, c) {
  for (const ch of String(s)) {
    if (x + f.w > W) break;
    const g = f.glyph(ch.codePointAt(0));
    for (let j = 0; j < f.h; j++)
      for (let i = 0; i < f.w; i++)
        if (g[j * f.row + (i >> 3)] & (0x80 >> (i & 7))) {
          const px = x + i, py = y + j;
          if (py < H) buf.writeUInt16LE(c, (py * W + px) * 2);
        }
    x += f.w;
  }
  return x;
}

const right = (f, xr, y, s, c) => text(f, xr - String(s).length * f.w, y, s, c);
const money = (v) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2);
const signed = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(2);
const pct = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
const tone = (v) => (v > 0 ? C.green : v < 0 ? C.red : C.fg);
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nyTime = () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// ── data ──
async function getJson(path) {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

function health(s, err) {
  if (err) return { c: C.red, t: 'NO DATA', why: String(err.message || err).slice(0, 58) };
  if (!s.ok) return { c: C.red, t: 'ERROR', why: String(s.lastError?.message || s.lastError || 'bot reports a problem').slice(0, 58) };
  if (s.broker?.enabled && s.broker.lastError) return { c: C.amber, t: 'BROKER', why: ('Alpaca: ' + s.broker.lastError).slice(0, 58) };
  const age = s.lastRun ? (Date.now() - Date.parse(s.lastRun)) / 60_000 : Infinity;
  if (s.marketOpen && age > 20) return { c: C.red, t: 'STALE', why: `no update for ${Math.round(age)} min` };
  return s.marketOpen ? { c: C.green, t: 'LIVE' } : { c: C.amber, t: 'CLOSED' };
}

function header(h, title, quiet = false) {
  rect(0, 0, W, 28, C.bar);
  text(MID, 6, 2, 'MIDAS', C.amber);
  if (!quiet) {
    text(SMALL, 76, 6, title, C.dim);
    right(MID, W - 6, 2, nyTime() + ' ET', C.fg);
  }
  const bw = h.t.length * 8 + 16;                     // status badge in the middle of the bar
  rect(W / 2 - bw / 2, 5, bw, 18, h.c);
  text(SMALL, W / 2 - bw / 2 + 8, 6, h.t, C.bg);
}

function line(x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) buf.writeUInt16LE(c, (y0 * W + x0) * 2);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

function footer(s, page) {
  rect(0, H - 20, W, 20, C.bar);
  const temp = (() => { try { return (fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8') / 1000).toFixed(0) + 'C'; } catch { return '?'; } })();
  const feed = s?.feed?.startsWith('alpaca') ? 'IEX' : s?.feed ? 'Yahoo' : '?';
  const broker = s?.broker?.enabled ? (s.broker.lastError ? 'paper ERR' : 'paper ok') : 'no broker';
  text(SMALL, 6, H - 18, `${s?.version ?? '?'}  ${feed}  ${broker}  Pi ${temp}  up ${s?.uptimeMin ?? '?'}m`, C.dim);
  right(SMALL, W - 6, H - 18, `page ${page + 1}/${PAGES}  tap`, C.dim);
}

const SHORT = { trend70: '70% trend', intraday: 'intraday only', margin: 'margin re-entry ($2k)' };
const shortName = (id, d) => SHORT[id] || (d?.label || id).replace('Shadow: ', '').slice(0, 24);

function pageBook(s, q, h) {
  header(h, 'Q desk');
  const main = q?.desks?.find((d) => d.id === 'main');
  let y = 36;
  if (h.why) { rect(0, y, W, 22, C.red); text(SMALL, 6, y + 3, h.why, C.fg); y += 28; }
  if (!s) return;
  text(SMALL, 8, y, 'BOOK', C.dim); text(SMALL, 250, y, 'TODAY', C.dim); y += 16;
  text(BIG, 8, y, money(s.equity ?? 0), C.fg);
  const dp = s.day?.pnl ?? 0;
  text(BIG, 250, y, signed(dp), tone(dp)); y += 34;
  const base = (s.equity ?? 0) - dp;
  text(SMALL, 250, y, base > 0 ? pct(dp / base) + (s.day?.inProgress ? '  so far' : '  closed') : '', tone(dp));
  text(SMALL, 8, y, `live ${s.liveDays} day${s.liveDays === 1 ? '' : 's'}: `, C.dim);
  text(SMALL, 8 + 18 * 8, y, signed(s.pnlLive ?? 0), tone(s.pnlLive ?? 0)); y += 24;
  text(MID, 8, y, 'Holding', C.dim);
  const held = [...(s.holding || [])];
  if (main?.intraday) held.push(`${main.intraday.shares} ${main.intraday.symbol} (intraday)`);
  text(MID, 120, y, held.length ? held.join(', ') : 'cash', C.fg); y += 30;
  const trend = main?.today?.trend;
  text(SMALL, 8, y, `trend sleeve: ${trend === 'on' ? 'ON (QQQ above 200-day)' : trend === 'off' ? 'OFF (cash)' : '-'}`, trend === 'on' ? C.green : C.dim);
  y += 24;
  rect(8, y, W - 16, 1, C.bar); y += 6;
  text(SMALL, 8, y, 'SHADOW DESKS (live P&L)', C.dim); y += 20;
  for (const sh of s.shadows || []) {
    const d = q?.desks?.find((x) => x.id === sh.id);
    text(MID, 8, y, shortName(sh.id, d), C.fg);
    right(MID, W - 8, y, signed(sh.pnlLive ?? 0), tone(sh.pnlLive ?? 0));
    y += 26;
    if (y > H - 46) break;
  }
}

// ── chart: QQQ today vs the noise band (same rules as js/bot/qdesk.js) ──
const NYP = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function sessions(points) {
  const days = new Map();
  for (const p of points || []) {
    const x = Object.fromEntries(NYP.formatToParts(new Date(p[0])).map((v) => [v.type, v.value]));
    const key = `${x.year}-${x.month}-${x.day}`, min = Number(x.hour) * 60 + Number(x.minute);
    if (min < 570 || min >= 960 || !(p[1] > 0)) continue;
    if (!days.has(key)) days.set(key, new Map());
    days.get(key).set(min, { c: p[1], o: p[2] || p[1] });
  }
  return days;
}

const closeAt = (day, min) => { for (let m = min - 5; m >= 570; m -= 5) if (day.has(m)) return day.get(m).c; return null; };
const lastClose = (day) => day.get(Math.max(...day.keys())).c;

function chartData(points) {
  const S = sessions(points), keys = [...S.keys()].sort();
  if (keys.length < 2) return null;
  const key = keys[keys.length - 1], day = S.get(key);
  if (!day.has(570)) return null;
  const moves = [];
  for (const k of keys.slice(0, -1)) {
    const d = S.get(k);
    if (!d.has(570) || d.size < 70) continue;
    const o = d.get(570).o;
    moves.push(Array.from({ length: 12 }, (_, i) => Math.abs((closeAt(d, 600 + 30 * i) ?? o) / o - 1)));
  }
  const prev = lastClose(S.get(keys[keys.length - 2])), open = day.get(570).o;
  const last = moves.slice(-14);
  const sig = last.length === 14 ? Array.from({ length: 12 }, (_, i) => last.reduce((a, m) => a + m[i], 0) / 14) : null;
  const px = [...day.entries()].sort((a, b) => a[0] - b[0]).map(([m, b]) => [m + 5, b.c]);
  return { key, prev, px, ub: sig?.map((v) => Math.max(open, prev) * (1 + v)), lb: sig?.map((v) => Math.min(open, prev) * (1 - v)) };
}

function pageChart(s, q, h, bars) {
  header(h, 'chart');
  let y = 34;
  if (h.why) { rect(0, y, W, 22, C.red); text(SMALL, 6, y + 3, h.why, C.fg); y += 26; }
  const cd = chartData(bars);
  if (!cd) { text(MID, 8, y + 10, 'no price data yet', C.dim); return; }
  const lastPx = cd.px[cd.px.length - 1][1], ch = lastPx / cd.prev - 1;
  text(MID, 8, y, `QQQ ${lastPx.toFixed(2)}`, C.fg);
  text(MID, 8 + 16 * 12, y, `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(2)}%`, tone(ch));
  right(SMALL, W - 8, y + 4, cd.key, C.dim);
  y += 30;
  const X0 = 56, X1 = W - 8, Y0 = y, Y1 = H - 40;
  const vals = [cd.prev, ...cd.px.map((p) => p[1]), ...(cd.ub || []), ...(cd.lb || [])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const xm = (m) => X0 + (m - 570) / 390 * (X1 - X0), yp = (v) => Y1 - (v - lo) / (hi - lo) * (Y1 - Y0);
  rect(X0, Y0, X1 - X0, Y1 - Y0, C.bar);
  for (const t of [600, 660, 720, 780, 840, 900]) {        // hour grid 10..15
    rect(Math.round(xm(t)), Y0, 1, Y1 - Y0, C.bg);
    text(SMALL, Math.round(xm(t)) - 8, Y1 + 2, String(t / 60 > 12 ? t / 60 - 12 : t / 60), C.dim);
  }
  for (let i = 0; i <= 3; i++) {
    const v = lo + (hi - lo) * (0.1 + 0.8 * i / 3);
    right(SMALL, X0 - 4, Math.round(yp(v)) - 8, v.toFixed(0), C.dim);
  }
  for (let x = X0; x < X1; x += 6) rect(x, Math.round(yp(cd.prev)), 3, 1, C.dim);   // yesterday's close, dashed
  for (const arr of cd.ub ? [cd.ub, cd.lb] : []) {           // band steps: level checked at each 30-min mark
    let prevY = null;
    arr.forEach((v, i) => {
      const xa = xm(570 + 30 * i), xb = xm(600 + 30 * i), yv = yp(v);
      if (prevY != null) line(xa, prevY, xa, yv, C.amber);
      line(xa, yv, xb, yv, C.amber); prevY = yv;
    });
  }
  for (let i = 1; i < cd.px.length; i++) line(xm(cd.px[i - 1][0]), yp(cd.px[i - 1][1]), xm(cd.px[i][0]), yp(cd.px[i][1]), C.fg);
  const main = q?.desks?.find((d) => d.id === 'main');
  const trades = [...(main?.today?.trades || [])];
  if (main?.intraday && !trades.some((t) => t.entryMin === main.intraday.entryMin)) trades.push(main.intraday);
  const at = (m) => { let best = cd.px[0]; for (const p of cd.px) if (p[0] <= m + 5) best = p; return best[1]; };
  for (const t of trades.filter((t) => t.sleeve === 'noise' && t.date === cd.key)) {
    const c = t.side === 'long' ? C.green : C.red;        // entry: triangle (green TQQQ below price, red SQQQ above)
    const ex = Math.round(xm(t.entryMin)), ey = Math.round(yp(at(t.entryMin)));
    for (let k = 0; k < 7; k++) rect(ex - k, t.side === 'long' ? ey + 4 + k : ey - 4 - k, 2 * k + 1, 1, c);
    if (t.exitMin) {                                       // exit: blue cross
      const xx = xm(Math.min(t.exitMin, 955)), xy = yp(at(t.exitMin));
      line(xx - 4, xy - 4, xx + 4, xy + 4, C.blue); line(xx - 4, xy + 4, xx + 4, xy - 4, C.blue);
    }
  }
  text(SMALL, X0 + 4, Y0 + 2, cd.ub ? 'band' : 'band: needs 14 days', C.amber);
}

function pageToday(s, q, h) {
  header(h, 'trades');
  const main = q?.desks?.find((d) => d.id === 'main');
  let y = 36;
  if (h.why) { rect(0, y, W, 22, C.red); text(SMALL, 6, y + 3, h.why, C.fg); y += 28; }
  const t = main?.today;
  text(MID, 8, y, `Main desk ${t?.key ?? ''}`, C.fg);
  if (t) right(MID, W - 8, y, signed(t.pnl ?? 0), tone(t.pnl ?? 0));
  y += 32;
  const trades = t?.trades || [];
  if (!trades.length) { text(MID, 8, y, main?.intraday ? 'position open, no exit yet' : 'no trades yet today', C.dim); y += 30; }
  text(SMALL, 8, y, 'time   what              shares  in      out       P&L', C.dim); y += 18;
  const rows = [...trades];
  if (main?.intraday && !rows.some((r) => r.open)) rows.push({ ...main.intraday, open: true });
  for (const r of rows.slice(-7)) {
    const what = `${r.sleeve === 'trend' ? 'trend' : 'intra'} ${r.side} ${r.symbol}`;
    const out = r.exit != null ? r.exit.toFixed(2) : r.open ? 'open' : '';
    text(SMALL, 8, y, `${hhmm(r.entryMin ?? r.exitMin ?? 0)}  ${what.padEnd(18)}${String(r.shares).padStart(6)}  ${(r.entry ?? 0).toFixed(2).padStart(6)}  ${out.padStart(6)}`, C.fg);
    if (r.pnl != null) right(SMALL, W - 8, y, signed(r.pnl), tone(r.pnl));
    y += 18;
    if (r.why) { text(SMALL, 64, y, r.why.slice(0, 50), C.dim); y += 18; }
    if (y > H - 60) break;
  }
  const others = (q?.desks || []).filter((d) => d.id !== 'main');
  y = Math.max(y + 6, H - 24 - 18 * others.length);
  for (const d of others) {
    const n = (d.today?.trades || []).filter((t) => t.sleeve === 'noise').length;
    const open = d.intraday ? `, ${d.intraday.symbol} open` : '';
    text(SMALL, 8, y, `${shortName(d.id, d).padEnd(22)} ${n} done${open}`, C.dim);
    right(SMALL, W - 8, y, signed(d.today?.pnl ?? 0), tone(d.today?.pnl ?? 0));
    y += 18;
  }
}

// ── loop ──
let page = Number(process.env.MIDAS_PAGE || 0), last = { s: null, q: null, bars: null, err: null }, fbFd = null, lastTap = 0;
const out = Buffer.alloc(W * H * 2);
const BACK_TO_FIRST = 2 * 60_000;                     // other pages fall back to page 1 after 2 min without a tap

function draw() {
  buf.fill(0); rect(0, 0, W, H, C.bg);
  const h = health(last.s, last.err);
  if (page === 0 && h.t === 'CLOSED') {               // market closed and all well: only the bar, nothing to read
    rect(0, 0, W, H, 0);
    header(h, '', true);
  } else {
    [pageBook, pageChart, pageToday][page](last.s, last.q, h, last.bars);
    footer(last.s, page);
  }
  try {
    fbFd ??= fs.openSync(FB, 'r+');
    let src = buf;
    if (FLIP) {
      for (let i = 0, n = W * H; i < n; i++) out.writeUInt16LE(buf.readUInt16LE(i * 2), (n - 1 - i) * 2);
      src = out;
    }
    fs.writeSync(fbFd, src, 0, src.length, 0);
  } catch (e) { console.error('framebuffer:', e.message); fbFd = null; }
}

async function refresh() {
  try {
    const [s, q, bars] = await Promise.all([getJson('/api/status'), getJson('/api/qdesk').catch(() => last.q),
      getJson('/api/bars?symbols=QQQ&range=60d&interval=5m').then((j) => j.bars?.QQQ).catch(() => last.bars)]);
    last = { s, q, bars, err: null };
  } catch (e) { last = { ...last, err: e }; }
  if (page !== 0 && lastTap && Date.now() - lastTap > BACK_TO_FIRST) page = 0;
  draw();
}

function watchTouch() {
  let dev = null;
  try {
    for (const blk of fs.readFileSync('/proc/bus/input/devices', 'utf8').split('\n\n'))
      if (/ADS7846/i.test(blk)) dev = blk.match(/event\d+/)?.[0];
  } catch {}
  if (!dev) return console.error('no touch device');
  const ev = 16;                                      // armv7: timeval 8 + type 2 + code 2 + value 4
  let carry = Buffer.alloc(0);
  fs.createReadStream(`/dev/input/${dev}`).on('data', (d) => {
    carry = Buffer.concat([carry, d]);
    while (carry.length >= ev) {
      const type = carry.readUInt16LE(8), code = carry.readUInt16LE(10), value = carry.readInt32LE(12);
      carry = carry.subarray(ev);
      if (type === 1 && code === 330 && value === 1 && Date.now() - lastTap > 600) {   // BTN_TOUCH down
        lastTap = Date.now(); page = (page + 1) % PAGES; draw();
      }
    }
  }).on('error', (e) => console.error('touch:', e.message));
}

watchTouch();
await refresh();
setInterval(refresh, EVERY);
