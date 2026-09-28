import { h, clear, segmented } from '../ui.js';
import { fmtMoney, fmtPrice, fmtQty, fmtDateTime, signClass } from '../format.js';
import { symbolLabel, tradePath } from '../assets.js';

const LABEL = { deposit: 'Deposit', withdraw: 'Withdrawal', buy: 'Buy', sell: 'Sell' };

export function renderActivity(root, { store, navigate }) {
  let filter = 'all';
  const tbody = h('tbody');
  const empty = h('div.empty', h('div.title', 'No activity yet'), h('div', 'Deposits and trades will show up here.'));
  const table = h('table.table',
    h('thead', h('tr',
      h('th', 'Date'), h('th', 'Type'), h('th', 'Symbol'), h('th.r', 'Qty'), h('th.r', 'Price'),
      h('th.r', 'Amount'), h('th.r.hide-sm', 'Realized'), h('th.r.hide-sm', 'Cash after'),
    )),
    tbody,
  );
  const seg = segmented([{ value: 'all', label: 'All' }, { value: 'trades', label: 'Trades' }, { value: 'cash', label: 'Cash' }], filter, (v) => { filter = v; update(); });
  const count = h('span.small.muted');

  root.append(
    h('div.page-head', h('h1', 'Activity'), seg.el),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Transactions'), count),
      h('div.table-scroll', table),
      empty,
    ),
  );

  function update() {
    const all = store.state.transactions;
    const list = all.filter((t) => filter === 'all' || (filter === 'trades' ? (t.type === 'buy' || t.type === 'sell') : (t.type === 'deposit' || t.type === 'withdraw'))).slice().reverse();
    count.textContent = list.length ? `${list.length} of ${all.length}` : '';
    empty.classList.toggle('hidden', list.length > 0);
    table.classList.toggle('hidden', list.length === 0);
    clear(tbody);
    for (const t of list) {
      const isTrade = t.type === 'buy' || t.type === 'sell';
      const tagCls = t.type === 'buy' || t.type === 'deposit' ? '.up' : '.down';
      tbody.append(h('tr' + (isTrade ? '.clickable' : ''), { onclick: isTrade ? () => navigate(tradePath(t.symbol)) : null },
        h('td', h('div', fmtDateTime(t.ts))),
        h('td', h('span.tag' + tagCls, LABEL[t.type] || t.type)),
        h('td.sym', t.symbol ? symbolLabel(t.symbol, store) : h('span.muted', '—')),
        h('td.r', isTrade ? fmtQty(t.qty) : h('span.muted', '—')),
        h('td.r', isTrade ? h('div', fmtPrice(t.price), t.delayed ? h('div.small.muted', 'Delayed 15 min') : null) : h('span.muted', '—')),
        h('td.r.' + signClass(t.amount), fmtMoney(t.amount, { sign: true })),
        h('td.r.hide-sm' + (t.realized != null ? '.' + signClass(t.realized) : ''), t.realized != null ? fmtMoney(t.realized, { sign: true }) : h('span.muted', '—')),
        h('td.r.hide-sm.muted', fmtMoney(t.cashAfter)),
      ));
    }
  }

  const unsub = store.subscribe((topic) => { if (topic === 'state') update(); });
  update();
  return unsub;
}
