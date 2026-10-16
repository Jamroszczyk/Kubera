// Directed force layout for the proxy graph. Predictor → target, with delay on the edge.

export function createProxyNetwork(canvas, { onSelect } = {}) {
  const ctx = canvas.getContext('2d');
  let nodes = [];
  let edges = [];
  let selected = null;
  let hover = null;
  let raf = null;
  let running = false;
  let drag = null;

  const ro = new ResizeObserver(() => request());
  ro.observe(canvas.parentElement || canvas);

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = local(e);
    if (drag) {
      drag.x = x; drag.y = y; drag.fx = x; drag.fy = y;
      request();
      return;
    }
    hover = hit(x, y);
    canvas.style.cursor = hover ? 'pointer' : 'default';
    request();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; request(); });
  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = local(e);
    const n = hit(x, y);
    if (n) {
      drag = n;
      canvas.setPointerCapture(e.pointerId);
      select(n.id);
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (drag) { drag.fx = null; drag.fy = null; }
    drag = null;
  });

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hit(x, y) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - x, dy = n.y - y;
      if (dx * dx + dy * dy <= 16 * 16) return n;
    }
    return null;
  }

  function css(name) {
    return getComputedStyle(canvas).getPropertyValue(name).trim();
  }

  function request() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; if (running) step(); draw(); });
  }

  function select(id) {
    selected = id;
    onSelect?.(id);
    request();
  }

  function setData(nextNodes, nextEdges) {
    const w = canvas.getBoundingClientRect().width || 800;
    const h = canvas.getBoundingClientRect().height || 480;
    const prev = new Map(nodes.map((n) => [n.id, n]));
    nodes = nextNodes.map((n, i) => {
      const old = prev.get(n.id);
      const ang = (i / Math.max(1, nextNodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: old?.x ?? w / 2 + Math.cos(ang) * Math.min(w, h) * 0.28,
        y: old?.y ?? h / 2 + Math.sin(ang) * Math.min(w, h) * 0.28,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        fx: null,
        fy: null,
      };
    });
    edges = nextEdges.slice();
    running = nodes.length > 0;
    for (let i = 0; i < 80; i++) step();
    request();
  }

  function step() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 800, h = rect.height || 480;
    const n = nodes.length;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let d2 = dx * dx + dy * dy || 0.01;
        const f = 1400 / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        nodes[i].vx -= f * dx; nodes[i].vy -= f * dy;
        nodes[j].vx += f * dx; nodes[j].vy += f * dy;
      }
    }
    for (const e of edges) {
      const a = nodes.find((x) => x.id === e.from);
      const b = nodes.find((x) => x.id === e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const rest = 130;
      const f = (d - rest) * 0.012;
      a.vx += f * dx / d; a.vy += f * dy / d;
      b.vx -= f * dx / d; b.vy -= f * dy / d;
    }
    for (const node of nodes) {
      node.vx += (w / 2 - node.x) * 0.004;
      node.vy += (h / 2 - node.y) * 0.004;
      if (node.fx != null) { node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0; }
      else {
        node.vx *= 0.78; node.vy *= 0.78;
        node.x += node.vx; node.y += node.vy;
        node.x = Math.min(w - 28, Math.max(28, node.x));
        node.y = Math.min(h - 28, Math.max(28, node.y));
      }
    }
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width), h = Math.floor(rect.height);
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const up = css('--up'), down = css('--down'), text = css('--text'), muted = css('--muted'), bg = css('--bg'), border = css('--border');

    for (const e of edges) {
      const a = nodes.find((x) => x.id === e.from);
      const b = nodes.find((x) => x.id === e.to);
      if (!a || !b) continue;
      const hot = selected && (e.from === selected || e.to === selected);
      const dim = selected && !hot;
      ctx.globalAlpha = dim ? 0.12 : hot ? 1 : 0.55;
      ctx.strokeStyle = e.r >= 0 ? up : down;
      ctx.lineWidth = 1 + Math.min(4, Math.abs(e.r) * 10);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const x1 = a.x + ux * 16, y1 = a.y + uy * 16;
      const x2 = b.x - ux * 16, y2 = b.y - uy * 16;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const ah = 8;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * ah + uy * 4, y2 - uy * ah - ux * 4);
      ctx.lineTo(x2 - ux * ah - uy * 4, y2 - uy * ah + ux * 4);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      ctx.globalAlpha = dim ? 0.12 : 0.9;
      ctx.fillStyle = muted;
      ctx.font = '11px ' + css('--font');
      ctx.textAlign = 'center';
      ctx.fillText(e.lagMin + 'm', (x1 + x2) / 2, (y1 + y2) / 2 - 5);
    }
    ctx.globalAlpha = 1;

    for (const n of nodes) {
      const on = n.id === selected || n.id === hover?.id;
      ctx.beginPath();
      ctx.arc(n.x, n.y, on ? 15 : 13, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = on ? 2 : 1;
      ctx.strokeStyle = on ? text : border;
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.font = (on ? '600 ' : '500 ') + '11px ' + css('--font');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.id, n.x, n.y);
    }
  }

  function setSelected(id) {
    selected = id;
    request();
  }

  function destroy() {
    running = false;
    ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
  }

  return { setData, setSelected, destroy };
}
