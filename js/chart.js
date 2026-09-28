// Minimal canvas line chart. Points are [ts, value]. Index-spaced on the x axis (like most trading
// UIs, so overnight gaps don't render as long flat lines). Colors come from CSS variables so the
// chart follows the theme.

import { fmtDate, fmtTime, timeLabelFormatter } from './format.js';

const DEFAULTS = {
  sparkline: false,
  color: 'auto',       // auto | up | down | accent | ink
  baseline: null,      // value; drawn as a dashed line and used for auto color
  fill: true,
  formatValue: (v) => String(v),
  formatTime: null,    // (ts) => label; defaults to a formatter chosen from the data span
};

export function createChart(canvas, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const ctx = canvas.getContext('2d');
  let data = [];
  let hoverX = null;
  let raf = null;

  const ro = new ResizeObserver(() => request());
  ro.observe(canvas.parentElement || canvas);

  if (!opts.sparkline) {
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      hoverX = e.clientX - r.left;
      request();
    });
    canvas.addEventListener('pointerleave', () => { hoverX = null; request(); });
  }

  function cssVar(name) {
    return getComputedStyle(canvas).getPropertyValue(name).trim();
  }

  function request() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; draw(); });
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
    if (data.length < 2) return;

    const sp = opts.sparkline;
    const pad = sp ? { t: 2, b: 2, l: 1, r: 1 } : { t: 26, b: 22, l: 4, r: 4 };
    const innerW = w - pad.l - pad.r;
    const innerH = hgt - pad.t - pad.b;

    let min = Infinity, max = -Infinity;
    for (const [, v] of data) { if (v < min) min = v; if (v > max) max = v; }
    if (opts.baseline != null) { min = Math.min(min, opts.baseline); max = Math.max(max, opts.baseline); }
    if (min === max) { min -= 1; max += 1; }
    const margin = (max - min) * 0.06;
    min -= margin; max += margin;

    const n = data.length;
    const x = (i) => pad.l + (i / (n - 1)) * innerW;
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * innerH;

    const first = data[0][1], last = data[n - 1][1];
    const ref = opts.baseline != null ? opts.baseline : first;
    let color;
    switch (opts.color) {
      case 'up': color = cssVar('--up'); break;
      case 'down': color = cssVar('--down'); break;
      case 'accent': color = cssVar('--accent'); break;
      case 'ink': color = cssVar('--text'); break;
      default: color = last >= ref ? cssVar('--up') : cssVar('--down');
    }
    const muted = cssVar('--muted');
    const border = cssVar('--border-strong');

    // Baseline
    if (opts.baseline != null && !sp) {
      ctx.save();
      ctx.strokeStyle = border;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      const by = Math.round(y(opts.baseline)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, by); ctx.lineTo(w - pad.r, by); ctx.stroke();
      ctx.restore();
    } else if (opts.baseline != null && sp) {
      ctx.save();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      const by = Math.round(y(opts.baseline)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, by); ctx.lineTo(w - pad.r, by); ctx.stroke();
      ctx.restore();
    }

    // Line path
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x(i), py = y(data[i][1]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }

    // Fill
    if (opts.fill) {
      ctx.save();
      ctx.lineTo(x(n - 1), pad.t + innerH);
      ctx.lineTo(x(0), pad.t + innerH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
      g.addColorStop(0, withAlpha(color, sp ? 0.18 : 0.16));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      // redraw the line path (fill consumed it)
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = x(i), py = y(data[i][1]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = sp ? 1.25 : 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    if (sp) return;

    // Time axis labels — evenly spaced, skipping any that would overlap.
    const fmtT = opts.formatTime || timeLabelFormatter(data[n - 1][0] - data[0][0]);
    ctx.fillStyle = muted;
    ctx.font = '11px ' + cssVar('--font');
    ctx.textBaseline = 'alphabetic';
    const labels = Math.min(6, Math.max(2, Math.floor(innerW / 120)));
    let lastRight = -Infinity;
    for (let k = 0; k < labels; k++) {
      const i = Math.round((k / (labels - 1)) * (n - 1));
      const text = fmtT(data[i][0]);
      const tw = ctx.measureText(text).width;
      let lx = x(i) - tw / 2;
      lx = Math.max(pad.l, Math.min(w - pad.r - tw, lx));
      if (lx < lastRight + 16) continue;
      ctx.fillText(text, lx, hgt - 6);
      lastRight = lx + tw;
    }

    // Min / max labels
    ctx.font = '11px ' + cssVar('--font');
    ctx.fillStyle = muted;
    let minI = 0, maxI = 0;
    for (let i = 1; i < n; i++) { if (data[i][1] < data[minI][1]) minI = i; if (data[i][1] > data[maxI][1]) maxI = i; }
    placeLabel(opts.formatValue(data[maxI][1]), x(maxI), y(data[maxI][1]) - 6, 'above');
    placeLabel(opts.formatValue(data[minI][1]), x(minI), y(data[minI][1]) + 14, 'below');

    function placeLabel(text, px, py, where) {
      const tw = ctx.measureText(text).width;
      let lx = px - tw / 2;
      lx = Math.max(pad.l, Math.min(w - pad.r - tw, lx));
      if (where === 'above' && py < pad.t - 10) py = pad.t - 10;
      ctx.fillText(text, lx, py);
    }

    // Hover crosshair
    if (hoverX != null) {
      const i = Math.max(0, Math.min(n - 1, Math.round(((hoverX - pad.l) / innerW) * (n - 1))));
      const px = x(i), py = y(data[i][1]);
      ctx.save();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(px) + 0.5, pad.t - 4); ctx.lineTo(Math.round(px) + 0.5, pad.t + innerH); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = cssVar('--bg');
      ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fill();

      const vText = opts.formatValue(data[i][1]);
      const tText = fmtDate(data[i][0]) + ', ' + fmtTime(data[i][0]);
      ctx.font = '600 12px ' + cssVar('--font');
      const vw = ctx.measureText(vText).width;
      ctx.font = '11px ' + cssVar('--font');
      const tw = ctx.measureText(tText).width;
      const total = vw + 8 + tw;
      let lx = px - total / 2;
      lx = Math.max(pad.l, Math.min(w - pad.r - total, lx));
      ctx.fillStyle = cssVar('--text');
      ctx.font = '600 12px ' + cssVar('--font');
      ctx.fillText(vText, lx, 14);
      ctx.fillStyle = muted;
      ctx.font = '11px ' + cssVar('--font');
      ctx.fillText(tText, lx + vw + 8, 14);
      ctx.restore();
    }
  }

  return {
    setData(next, patch) {
      data = Array.isArray(next) ? next : [];
      if (patch) Object.assign(opts, patch);
      request();
    },
    setOptions(patch) {
      Object.assign(opts, patch);
      request();
    },
    redraw: request,
    destroy() {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

function withAlpha(color, a) {
  // Accepts #rgb, #rrggbb, or rgb()/rgba().
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((s) => parseFloat(s));
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}
