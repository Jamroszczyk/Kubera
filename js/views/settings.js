import { h, segmented, toast, confirmDialog, setText } from '../ui.js';
import { fmtMoney } from '../format.js';
import { config } from '../config.js';

export function renderSettings(root, { store, market, applyTheme, openDeposit }) {
  const s = store.state.settings;

  // ── Market data ──────────────────────────────────────────────
  const usingEnv = !s.apiKey && !!config.envApiKey;
  const keyInput = h('input.input', { type: 'password', value: s.apiKey, placeholder: usingEnv ? 'Using FINNHUB_API_KEY from .env — paste a key here to override' : 'Paste your Finnhub API key', autocomplete: 'off', spellcheck: false });
  const showBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } }, 'Show');
  const feedLine = h('div.small.muted');
  const dataCard = h('div.card',
    h('div.card-head', h('h2', 'Market data')),
    h('form.stack', { onsubmit: (e) => { e.preventDefault(); saveKey(); } },
      h('div.field',
        h('label', 'Finnhub API key'),
        h('div.row', keyInput, showBtn),
        h('div.hint', 'Free at ', h('a', { href: 'https://finnhub.io/register', target: '_blank', rel: 'noopener', style: { color: 'var(--accent)' } }, 'finnhub.io/register'),
          ' — real-time US stocks, crypto and forex. International stocks use a delayed quote and do not need a key. The key is stored only in this browser.'),
      ),
      h('div.row', h('button.btn.btn-primary', { type: 'submit' }, 'Save & connect'), feedLine),
    ),
  );

  function saveKey() {
    const key = keyInput.value.trim();
    store.setSettings({ apiKey: key });
    market.restart();
    toast(key ? 'Connecting…' : config.envApiKey ? 'Using key from .env' : 'API key removed');
  }

  // ── Appearance ───────────────────────────────────────────────
  const themeSeg = segmented([{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], s.theme, (v) => {
    store.setSettings({ theme: v });
    applyTheme();
  });
  const pollInput = h('input.input', { type: 'number', min: '5', max: '300', step: '5', value: s.pollSeconds, style: { width: '100px' } });
  pollInput.addEventListener('change', () => {
    const v = Math.max(5, Math.min(300, parseInt(pollInput.value, 10) || 20));
    pollInput.value = v;
    store.setSettings({ pollSeconds: v });
  });
  const prefsCard = h('div.card',
    h('div.card-head', h('h2', 'Preferences')),
    h('div.stack',
      h('div.row.between', h('div', h('div', 'Theme'), h('div.small.muted', 'Follows your OS by default.')), themeSeg.el),
      h('div.row.between', h('div', h('div', 'Quote refresh'), h('div.small.muted', 'Seconds between REST refreshes when the live stream is idle.')), h('div.row', pollInput, h('span.small.muted', 's'))),
    ),
  );

  // ── Account ──────────────────────────────────────────────────
  const cashLine = h('div.value');
  const accountCard = h('div.card',
    h('div.card-head', h('h2', 'Virtual account')),
    h('div.stack',
      h('div.row.between',
        h('div.stat', h('div.label', 'Cash balance'), cashLine),
        h('div.row', h('button.btn', { onclick: () => openDeposit('withdraw') }, 'Withdraw'), h('button.btn.btn-primary', { onclick: () => openDeposit('deposit') }, 'Deposit')),
      ),
      h('div.divider'),
      h('div.row.between',
        h('div', h('div', 'Reset account'), h('div.small.muted', 'Clears cash, positions and history. Keeps your API key and watchlist.')),
        h('button.btn.btn-danger', { onclick: async () => {
          if (await confirmDialog('Reset the virtual account? All positions, transactions and account history will be deleted.', { confirmLabel: 'Reset', danger: true })) {
            store.resetAccount();
            toast('Account reset');
          }
        } }, 'Reset'),
      ),
    ),
  );

  // ── Data ─────────────────────────────────────────────────────
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (await confirmDialog('Importing will replace the current account, positions and history.', { confirmLabel: 'Import', danger: true })) {
        store.importJSON(text);
        market.restart();
        applyTheme();
        toast('Import complete', 'success');
      }
    } catch (e) {
      toast(e.message || 'Import failed', 'error');
    }
    fileInput.value = '';
  });
  const storageLine = h('div.small.muted');
  const dataCard2 = h('div.card',
    h('div.card-head', h('h2', 'Your data')),
    h('div.stack',
      h('div.row.between',
        h('div', h('div', 'Export'), h('div.small.muted', 'Download everything as JSON — handy for backups and analysis.')),
        h('button.btn', { onclick: exportJSON }, 'Export JSON'),
      ),
      h('div.row.between',
        h('div', h('div', 'Import'), h('div.small.muted', 'Restore a previous export.')),
        h('button.btn', { onclick: () => fileInput.click() }, 'Import JSON'),
      ),
      storageLine,
      fileInput,
    ),
  );

  function exportJSON() {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `midas-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  root.append(
    h('div.page-head', h('h1', 'Settings')),
    h('div.stack', dataCard, accountCard, prefsCard, dataCard2,
      h('p.small.muted', { style: { textAlign: 'center', marginTop: '8px' } }, 'Midas is a paper-trading simulator. No real orders are placed. Everything lives in your browser\u2019s local storage.'),
    ),
  );

  function update() {
    setText(cashLine, fmtMoney(store.state.cash));
    const detail = market.statusDetail ? ' — ' + market.statusDetail : '';
    const label = { offline: 'Offline', connecting: 'Connecting', live: 'Live stream connected', polling: 'Polling quotes', error: 'Error' }[market.status] || market.status;
    setText(feedLine, label + detail + (market.marketOpen != null ? (market.marketOpen ? ' · Market open' : ' · Market closed') : ''));
    try {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('midas.')) bytes += (localStorage.getItem(k) || '').length * 2;
      }
      const symbols = Object.keys(store.history).length;
      const samples = Object.values(store.history).reduce((n, a) => n + a.length, 0);
      setText(storageLine, `${(bytes / 1024).toFixed(0)} KB stored · ${samples.toLocaleString()} price samples across ${symbols} symbols · ${store.equity.length.toLocaleString()} account snapshots`);
    } catch { /* ignore */ }
  }

  const unsub = store.subscribe(update);
  const unsubStatus = market.onStatus(update);
  update();
  return () => { unsub(); unsubStatus(); };
}
