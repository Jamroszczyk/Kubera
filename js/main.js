import { Store, computePortfolio } from './store.js';
import { config, loadConfig } from './config.js';
import { createFinnhub } from './providers/finnhub.js';
import { Market } from './market.js';
import { h, clear, openModal, segmented, toast, setText } from './ui.js';
import { fmtMoney } from './format.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTrade } from './views/trade.js';
import { renderActivity } from './views/activity.js';
import { renderSettings } from './views/settings.js';
import { forexOpen } from './assets.js';

const store = new Store();
// A key entered in Settings wins; otherwise fall back to FINNHUB_API_KEY from .env (via server.js).
const provider = createFinnhub(() => store.state.settings.apiKey || config.envApiKey);
const market = new Market(store, provider);

// ── Theme ──────────────────────────────────────────────────────
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = store.state.settings.theme;
  const theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  // Charts read CSS variables at draw time; nudge them to redraw.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
mq.addEventListener('change', () => { if (store.state.settings.theme === 'system') applyTheme(); });
document.getElementById('theme-btn').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  store.setSettings({ theme: current === 'dark' ? 'light' : 'dark' });
  applyTheme();
});
applyTheme();

// ── Feed status indicator ──────────────────────────────────────
const feedEl = document.getElementById('feed-status');
market.onStatus((status, m) => {
  feedEl.className = 'feed ' + status;
  const label = { offline: 'Offline', connecting: 'Connecting', live: 'Live', polling: 'Delayed', error: 'Error' }[status] || status;
  const focus = m.focus ? store.assetOf(m.focus) : null;
  let suffix = '';
  let title = m.statusDetail || label;
  if (focus?.asset === 'crypto') {
    suffix = ' · 24/7';
    title += ' · Crypto market is open 24/7';
  } else if (focus?.asset === 'forex') {
    const open = forexOpen();
    suffix = open ? ' · FX open' : ' · FX closed';
    title += open ? ' · Forex market is open' : ' · Forex market is closed';
  } else if (focus?.delayed) {
    suffix = status === 'polling' ? '' : ' · 15m delay';
    title += ' · International quote delayed about 15 minutes';
  } else if (m.marketOpen != null) {
    suffix = m.marketOpen ? '' : ' · Closed';
    title += m.marketOpen ? ' · US market open' : ' · US market closed';
  }
  setText(feedEl.querySelector('.feed-label'), label + suffix);
  feedEl.title = title;
});

// ── Deposit / withdraw modal ───────────────────────────────────
function openDeposit(initial = 'deposit') {
  let kind = initial;
  const amount = h('input.input.lg.has-prefix', { type: 'number', min: '0', step: 'any', placeholder: '0.00', inputmode: 'decimal' });
  const err = h('div.small.neg', { style: { minHeight: '18px', marginTop: '8px' } });
  const balance = h('div.small.muted', 'Balance: ' + fmtMoney(store.state.cash));
  const submitBtn = h('button.btn.btn-primary', { type: 'submit' }, 'Deposit');
  const seg = segmented([{ value: 'deposit', label: 'Deposit' }, { value: 'withdraw', label: 'Withdraw' }], kind, (v) => { kind = v; setText(submitBtn, v === 'deposit' ? 'Deposit' : 'Withdraw'); amount.focus(); }, { block: true });
  const quick = h('div.row', ...[1000, 10000, 100000].map((v) => h('button.btn.btn-sm', { type: 'button', onclick: () => { amount.value = v; amount.focus(); } }, '$' + (v / 1000) + 'K')));

  const modal = openModal({
    title: 'Virtual funds',
    content: h('form', { onsubmit: (e) => {
      e.preventDefault();
      try {
        const v = parseFloat(amount.value);
        if (kind === 'deposit') { store.deposit(v); toast(`Deposited ${fmtMoney(v)}`, 'success'); }
        else { store.withdraw(v); toast(`Withdrew ${fmtMoney(v)}`, 'success'); }
        modal.close();
      } catch (ex) {
        setText(err, ex.message);
      }
    } },
      seg.el,
      h('div.field', { style: { marginTop: '16px' } },
        h('div.row.between', h('label', 'Amount'), balance),
        h('div.input-wrap', h('span.prefix', '$'), amount),
      ),
      h('div', { style: { marginTop: '10px' } }, quick),
      err,
      h('div.actions', h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), submitBtn),
    ),
  });
  setText(submitBtn, kind === 'deposit' ? 'Deposit' : 'Withdraw');
  amount.focus();
}
document.getElementById('deposit-btn').addEventListener('click', () => openDeposit('deposit'));

// ── Router ─────────────────────────────────────────────────────
const view = document.getElementById('view');
const routes = {
  dashboard: renderDashboard,
  trade: renderTrade,
  activity: renderActivity,
  settings: renderSettings,
};
let cleanup = null;

function navigate(path) {
  location.hash = '#' + path;
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = hash.split('/');
  return { name: name || 'dashboard', params: { symbol: rest[0] ? decodeURIComponent(rest[0]) : null } };
}

function render() {
  const { name, params } = parseHash();
  const fn = routes[name] || routes.dashboard;
  cleanup?.();
  cleanup = null;
  clear(view);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (routes[name] ? name : 'dashboard')));
  document.title = name === 'trade' && params.symbol ? `${params.symbol} · Midas` : 'Midas';
  try {
    cleanup = fn(view, { store, market, navigate, params, openDeposit, applyTheme }) || null;
  } catch (e) {
    console.error(e);
    view.append(h('div.empty', h('div.title', 'Something went wrong'), h('div.small', e.message)));
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();

// ── Start the feed (after picking up the .env key, if any) ─────
loadConfig().then(() => {
  market.start();
  if (!store.state.settings.apiKey && config.envApiKey) render(); // refresh "add a key" banners
});

// Expose for experiments, bots and analysis from the browser console.
window.midas = { store, market, provider, computePortfolio, navigate };
