// Price path with the book's fills drawn on it. Overview is the full tape.
// Click a marker to see that session's 5-minute bars, range, stop and target.

import { fmtDate, timeLabelFormatter } from '../format.js';
import { nyDate, nyTime } from './clock.js';

export function createRunChart(canvas, { onSelect, formatPrice } = {}) {
  const ctx = canvas.getContext('2d');
  let price = [];
  let paths = {};
  let trades = [];
  let focusKey = null;
  let focusSym = null;
  let hoverX = null;
  let raf = null;

  const ro = new ResizeObserver(() => request());
  ro.observe(canvas.parentElement || canvas);

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    hoverX = e.clientX - r.left;
    canvas.style.cursor = nearestTrade(hoverX) ? 'pointer' : 'crosshair';
    request();
  });
  canvas.addEventListener('pointerleave', () => { hoverX = null; canvas.style.cursor = ''; request(); });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const hit = nearestTrade(x);
    if (hit && onSelect) onSelect(hit.trade);
  });

  function cssVar(name) {
    return getComputedStyle(canvas).getPropertyValue(name).trim();
  }

  function request() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; draw(); });
  }

  function seriesFor() {
    if (focusSym && paths[focusSym]?.length) return paths[focusSym];
    return price;
  }

  function bars() {
    const src = seriesFor();
    if (!focusKey) return src;
    return src.filter((p) => nyDate(p[0]) === focusKey);
  }

  function layout(w, hgt) {
    const pad = { t: 28, b: 24, l: 8, r: 8 };
    const innerW = w - pad.l - pad.r;
    const innerH = hgt - pad.t - pad.b;
    const pts = bars();
    const n = pts.length;
    const x = (i) => pad.l + (n < 2 ? innerW / 2 : (i / (n - 1)) * innerW);
    let min = Infinity, max = -Infinity;
    for (const p of pts) {
      const lo = p[3] != null ? p[3] : p[4];
      const hi = p[2] != null ? p[2] : p[4];
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    const vis = visibleTrades(pts);
    for (const t of vis) {
      for (const v of [t.entry, t.exit, t.stop, t.target, t.orHi, t.orLo]) {
        if (v > 0) { if (v < min) min = v; if (v > max) max = v; }
      }
    }
    if (!Number.isFinite(min) || min === max) { min = (min || 0) - 1; max = (max || 0) + 1; }
    const margin = (max - min) * 0.08;
    min -= margin; max += margin;
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * innerH;
    return { pad, innerW, innerH, pts, n, x, y, min, max, vis };
  }

  function visibleTrades(pts) {
    if (!pts.length) return [];
    const a = pts[0][0], b = pts[pts.length - 1][0];
    return trades.filter((t) => {
      if (t.buyTs < a || t.buyTs > b + 5 * 60_000) return false;
      if (focusSym && t.symbol !== focusSym) return false;
      return true;
    });
  }

  function nearestIndex(pts, n, innerW, pad, px) {
    if (n < 2) return 0;
    return Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / innerW) * (n - 1))));
  }

  function nearestTrade(px) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width), hgt = Math.floor(rect.height);
    if (!w || !hgt) return null;
    const L = layout(w, hgt);
    if (L.n < 2) return null;
    let best = null;
    for (const t of L.vis) {
      const i = indexAt(L.pts, t.buyTs);
      const dx = px - L.x(i);
      const d = Math.abs(dx);
      if (d < 16 && (!best || d < best.d)) best = { trade: t, d };
    }
    return best;
  }

  function indexAt(pts, ts) {
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] < ts) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(pts[lo - 1][0] - ts) < Math.abs(pts[lo][0] - ts)) return lo - 1;
    return lo;
  }

  function triangle(px, py, dir, fill) {
    ctx.beginPath();
    if (dir === 'up') {
      ctx.moveTo(px, py - 7);
      ctx.lineTo(px + 5.5, py + 4);
      ctx.lineTo(px - 5.5, py + 4);
    } else {
      ctx.moveTo(px, py + 7);
      ctx.lineTo(px + 5.5, py - 4);
      ctx.lineTo(px - 5.5, py - 4);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width), hgt = Math.floor(rect.height);
    if (!w || !hgt) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== hgt * dpr) {
      canvas.width = w * dpr;
      canvas.height = hgt * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const L = layout(w, hgt);
    if (L.n < 2) return;

    const up = cssVar('--up');
    const down = cssVar('--down');
    const muted = cssVar('--muted');
    const border = cssVar('--border-strong');
    const text = cssVar('--text');
    const ink = cssVar('--text-2');
    const font = cssVar('--font');

    const dayView = !!focusKey;

    if (dayView) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      for (let i = 0; i < L.n; i++) {
        const p = L.pts[i];
        const px = Math.round(L.x(i)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, L.y(p[2]));
        ctx.lineTo(px, L.y(p[3]));
        ctx.stroke();
        ctx.fillStyle = p[4] >= p[1] ? up : down;
        ctx.fillRect(px - 2, Math.round(L.y(p[4])) - 1, 4, 2);
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < L.n; i++) {
        const px = L.x(i), py = L.y(L.pts[i][4]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    function dashLine(val, color, dash) {
      if (!(val > 0)) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1;
      const yy = Math.round(L.y(val)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(L.pad.l, yy);
      ctx.lineTo(w - L.pad.r, yy);
      ctx.stroke();
      ctx.restore();
    }

    function edgeLabel(val, textL, color) {
      if (!(val > 0)) return;
      ctx.fillStyle = color;
      ctx.font = '11px ' + font;
      const tw = ctx.measureText(textL).width;
      ctx.fillText(textL, w - L.pad.r - tw, L.y(val) - 4);
    }

    if (dayView && L.vis[0]) {
      const t = L.vis[0];
      dashLine(t.orHi, muted, [4, 4]);
      dashLine(t.orLo, muted, [4, 4]);
      dashLine(t.stop, down, [2, 3]);
      dashLine(t.target, up, [2, 3]);
      const band = (L.max - L.min) * 0.03;
      if (Math.abs(t.orHi - t.stop) > band) edgeLabel(t.orHi, 'range high', muted);
      if (Math.abs(t.orLo - t.stop) > band) edgeLabel(t.orLo, 'range low', muted);
      edgeLabel(t.stop, 'stop', down);
      edgeLabel(t.target, 'target', up);
    }

    for (const t of L.vis) {
      const i0 = indexAt(L.pts, t.buyTs);
      const i1 = indexAt(L.pts, t.sellTs);
      const x0 = L.x(i0), y0 = L.y(t.entry);
      const x1 = L.x(i1), y1 = L.y(t.exit);
      ctx.save();
      ctx.strokeStyle = t.pnl >= 0 ? up : down;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
      triangle(x0, y0, t.side === 'long' ? 'up' : 'down', t.side === 'long' ? up : down);
      ctx.beginPath();
      ctx.arc(x1, y1, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = t.pnl >= 0 ? up : down;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x1, y1, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = cssVar('--bg');
      ctx.fill();
    }

    const fmtT = dayView ? nyTime : timeLabelFormatter(L.pts[L.n - 1][0] - L.pts[0][0]);
    ctx.fillStyle = muted;
    ctx.font = '11px ' + font;
    const labels = Math.min(6, Math.max(2, Math.floor(L.innerW / 110)));
    let lastRight = -Infinity;
    for (let k = 0; k < labels; k++) {
      const i = Math.round((k / (labels - 1)) * (L.n - 1));
      const textL = fmtT(L.pts[i][0]);
      const tw = ctx.measureText(textL).width;
      let lx = L.x(i) - tw / 2;
      lx = Math.max(L.pad.l, Math.min(w - L.pad.r - tw, lx));
      if (lx < lastRight + 14) continue;
      ctx.fillText(textL, lx, hgt - 6);
      lastRight = lx + tw;
    }

    const fmt = formatPrice || ((v) => String(v));
    ctx.fillText(fmt(L.max), L.pad.l, 16);
    ctx.fillText(fmt(L.min), L.pad.l, hgt - 28);

    if (hoverX != null) {
      const i = nearestIndex(L.pts, L.n, L.innerW, L.pad, hoverX);
      const px = L.x(i), py = L.y(L.pts[i][4]);
      ctx.save();
      ctx.strokeStyle = border;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, L.pad.t - 4);
      ctx.lineTo(Math.round(px) + 0.5, L.pad.t + L.innerH);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      const hit = nearestTrade(hoverX);
      const vText = fmt(L.pts[i][4]);
      let tText = dayView
        ? nyTime(L.pts[i][0])
        : fmtDate(L.pts[i][0]) + ' ' + nyTime(L.pts[i][0]);
      if (hit) {
        const p = hit.trade.pnl;
        tText += '  ·  ' + (hit.trade.side === 'long' ? 'Long' : 'Short')
          + '  ' + (p >= 0 ? '+' : '-') + Math.abs(p).toFixed(2)
          + '  ' + hit.trade.reason;
      }
      ctx.font = '600 12px ' + font;
      ctx.fillStyle = text;
      ctx.fillText(vText, L.pad.l + 80, 16);
      ctx.font = '11px ' + font;
      ctx.fillStyle = muted;
      ctx.fillText(tText, L.pad.l + 80 + ctx.measureText(vText).width + 10, 16);
      ctx.restore();
    }
  }

  return {
    setData({ price: nextPrice, paths: nextPaths, trades: nextTrades, focus, symbol } = {}) {
      if (nextPrice) price = nextPrice;
      if (nextPaths) paths = nextPaths;
      if (nextTrades) trades = nextTrades;
      if (focus !== undefined) focusKey = focus;
      if (symbol !== undefined) focusSym = symbol;
      request();
    },
    setFocus(key, sym) {
      focusKey = key || null;
      if (sym !== undefined) focusSym = sym;
      request();
    },
    redraw: request,
    destroy() {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
