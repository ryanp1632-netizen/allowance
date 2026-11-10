// Allowance dashboard. Polls the server every second or two and redraws.
// All text that comes from sellers or the AI is escaped before it touches the page.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (cents) => (cents == null ? '' : `$${(cents / 100).toFixed(2)}`);
const STATUS_LABEL = { paid: 'Paid', blocked: 'Blocked', pending_approval: 'Waiting for you', denied: 'Denied by you', processing: 'Sending…', failed: 'PayPal failed' };
const riskColor = (r) => (r == null ? 'var(--muted)' : r >= 75 ? 'var(--bad)' : r >= 40 ? '#e0a100' : 'var(--ok)');

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function riskHtml(score) {
  const w = score == null ? 0 : score;
  return `<div class="risk"><span>Risk <b>${score == null ? 'n/a' : score}</b>/100</span><span class="bar"><i style="width:${w}%;background:${riskColor(score)}"></i></span></div>`;
}

function checksHtml(checks) {
  const icon = { pass: '✔', review: '⚠', block: '✘' };
  return `<ul class="checks">${(checks || []).map((c) =>
    `<li><span class="${c.status}">${icon[c.status]}</span><span><b>${esc(c.label)}</b></span><span class="muted">${esc(c.detail)}</span></li>`).join('')}</ul>`;
}

const itemsText = (items) => (items || []).map((i) => `${i.quantity ?? 1} × ${i.name}`).join(', ');

// ---------------- summary, approvals, rules ----------------
let state = null;
let rulesLoaded = false;

async function refreshState() {
  state = await api('GET', '/api/state');
  const s = state.settings;
  $('s-balance').textContent = money(state.balanceCents);
  $('s-today').textContent = money(state.todayCents);
  $('s-today-bar').style.width = `${Math.min(100, (state.todayCents / Math.max(1, s.dailyCapCents)) * 100)}%`;
  $('s-cap').textContent = `of ${money(s.dailyCapCents)} daily cap`;
  $('s-pending').textContent = state.pending.length;
  $('s-counts').textContent = `${state.counts.paid} / ${state.counts.blocked}`;

  const kill = $('kill');
  kill.classList.toggle('on', s.killSwitch);
  kill.setAttribute('aria-pressed', String(s.killSwitch));
  $('kill-label').textContent = s.killSwitch ? 'Kill switch: ON (spending stopped)' : 'Kill switch: off';

  renderApprovals(state.pending);
  renderSellers(state.sellers);
  if (!rulesLoaded) {
    $('r-cap').value = s.dailyCapCents / 100;
    $('r-threshold').value = s.approvalThresholdCents / 100;
    $('r-review').value = s.riskReviewScore;
    $('r-block').value = s.riskBlockScore;
    rulesLoaded = true;
  }
}

let approvalsKey = '';
function renderApprovals(pending) {
  const key = pending.map((p) => p.id).join();
  if (key === approvalsKey) return; // don't redraw (keeps buttons stable while clicking)
  approvalsKey = key;
  if (!pending.length) {
    $('approvals').innerHTML = '<p class="empty">Nothing waiting. Payments over your limit or flagged as risky show up here.</p>';
    return;
  }
  $('approvals').innerHTML = pending.map((p) => `
    <div class="approval">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><div class="amt">${money(p.amount_cents)}</div><div class="small muted">to ${esc(p.seller_name)}</div></div>
        <span class="pill pending_approval">${esc(p.reason)}</span>
      </div>
      <div class="small">${esc(itemsText(p.items))}</div>
      <div class="why"><b>Agent's explanation</b>${esc(p.justification)}</div>
      ${riskHtml(p.risk_score)}
      ${p.risk_reasons?.length ? `<ul class="reasons">${p.risk_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <div class="row">
        <button class="btn ok" data-approve="${p.id}">Approve &amp; pay with PayPal</button>
        <button class="btn bad" data-deny="${p.id}">Deny</button>
      </div>
    </div>`).join('');
}

$('approvals').addEventListener('click', async (e) => {
  const id = e.target.dataset.approve || e.target.dataset.deny;
  if (!id) return;
  e.target.disabled = true;
  try {
    if (e.target.dataset.approve) {
      const p = await api('POST', `/api/payments/${id}/approve`);
      toast(p.status === 'paid' ? `Paid ${money(p.amount_cents)} via PayPal sandbox` : `PayPal: ${p.error || p.status}`);
    } else {
      await api('POST', `/api/payments/${id}/deny`);
      toast('Payment denied. No money moved.');
    }
  } catch (err) {
    toast(err.message);
    e.target.disabled = false;
  }
  approvalsKey = '';
  refreshAll();
});

let sellersKey = '';
function renderSellers(sellers) {
  const key = JSON.stringify(sellers.map((s) => [s.id, s.approved]));
  if (key === sellersKey) return;
  sellersKey = key;
  $('sellers').innerHTML = sellers.map((s) => `
    <li><input type="checkbox" id="sel-${esc(s.id)}" data-seller="${esc(s.id)}" ${s.approved ? 'checked' : ''}>
      <label for="sel-${esc(s.id)}">${esc(s.name)} <small>${esc(s.category)}</small></label></li>`).join('');
}

$('sellers').addEventListener('change', async (e) => {
  const id = e.target.dataset.seller;
  if (!id) return;
  try {
    await api('POST', `/api/sellers/${encodeURIComponent(id)}`, { approved: e.target.checked });
    toast(`${e.target.checked ? 'Approved' : 'Removed'} seller`);
  } catch (err) { toast(err.message); }
});

$('rules-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/settings', {
      dailyCap: $('r-cap').value, approvalThreshold: $('r-threshold').value,
      riskReviewScore: Number($('r-review').value), riskBlockScore: Number($('r-block').value),
    });
    toast('Rules saved');
    refreshState();
  } catch (err) { toast(err.message); }
});

$('kill').addEventListener('click', async () => {
  const on = !state?.settings.killSwitch;
  await api('POST', '/api/kill-switch', { on });
  toast(on ? 'Kill switch ON: the agent cannot spend anything' : 'Kill switch off');
  refreshAll();
});

// ---------------- tasks + live feed ----------------
$('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('task-run').disabled = true;
  try {
    await api('POST', '/api/tasks', { prompt: $('task-prompt').value, budget: $('task-budget').value });
    toast('Agent started');
  } catch (err) { toast(err.message); }
  setTimeout(() => { $('task-run').disabled = false; }, 1500);
});

let lastEventId = 0;
const KIND_LABEL = { task: 'task', tool: 'agent', think: 'thinks', audit: 'explain', allow: 'allowed', review: 'review', block: 'blocked', paid: 'PayPal', done: 'done', error: 'error', info: 'info', human: 'you', topup: 'top-up' };
async function refreshEvents() {
  const events = await api('GET', `/api/events?after=${lastEventId}`);
  if (!events.length) return;
  const feed = $('feed');
  if (lastEventId === 0) feed.innerHTML = '';
  for (const ev of events) {
    lastEventId = ev.id;
    const li = document.createElement('li');
    li.className = ev.kind;
    li.innerHTML = `<span class="k">${esc(KIND_LABEL[ev.kind] || ev.kind)}</span><span>${esc(ev.message)}</span>`;
    feed.prepend(li);
  }
  while (feed.children.length > 150) feed.lastChild.remove();
}

// ---------------- AG Grid ledger ----------------
const columnDefs = [
  { headerName: 'Time', field: 'created_at', sort: 'desc', width: 110,
    valueFormatter: (p) => new Date(p.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
  { headerName: 'Seller', field: 'seller_name', width: 160 },
  { headerName: 'Amount', field: 'amount_cents', width: 105, type: 'rightAligned', valueFormatter: (p) => money(p.value),
    filter: 'agNumberColumnFilter', filterValueGetter: (p) => p.data.amount_cents / 100 },
  { headerName: 'Decision', field: 'status', width: 150, filter: true,
    valueFormatter: (p) => STATUS_LABEL[p.value] || p.value,
    cellRenderer: (p) => `<span class="pill ${esc(p.value)}">${esc(STATUS_LABEL[p.value] || p.value)}</span>` },
  { headerName: 'Risk', field: 'risk_score', width: 120, filter: 'agNumberColumnFilter',
    cellRenderer: (p) => `<span style="color:${riskColor(p.value)};font-weight:700">${p.value ?? 'n/a'}</span>` },
  { headerName: "Agent's explanation", field: 'justification', flex: 2, minWidth: 260, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.35', padding: '6px 10px' } },
  { headerName: 'Guardrail result', field: 'reason', flex: 1, minWidth: 200, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.35', padding: '6px 10px' } },
  { headerName: 'PayPal payout', field: 'payout_status', width: 170,
    valueGetter: (p) => (p.data.payout_batch_id ? `${p.data.payout_status || ''} · ${p.data.payout_batch_id}` : p.data.error ? 'error' : '—') },
  { headerName: 'Decided by', field: 'decided_by', width: 110 },
];

const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
const theme = isDark && agGrid.colorSchemeDark ? agGrid.themeQuartz.withPart(agGrid.colorSchemeDark) : agGrid.themeQuartz;
const grid = agGrid.createGrid($('grid'), {
  theme,
  columnDefs,
  rowData: [],
  defaultColDef: { sortable: true, resizable: true, filter: true },
  getRowId: (p) => p.data.id,
  animateRows: true,
  overlayNoRowsTemplate: '<span class="muted">No payments yet. Every attempt (paid or blocked) lands here.</span>',
  onRowClicked: (e) => showDetail(e.data),
});

$('grid-search').addEventListener('input', (e) => grid.setGridOption('quickFilterText', e.target.value));
$('grid-export').addEventListener('click', () => grid.exportDataAsCsv({ fileName: 'allowance-ledger.csv' }));

async function refreshPayments() {
  grid.setGridOption('rowData', await api('GET', '/api/payments'));
}

function showDetail(p) {
  $('detail-body').innerHTML = `
    <h2>${money(p.amount_cents)} to ${esc(p.seller_name)} <span class="pill ${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span></h2>
    <p class="small">${esc(itemsText(p.items))}${p.menu_total_cents != null ? ` <span class="muted">(menu total ${money(p.menu_total_cents)})</span>` : ''}</p>
    <div class="why"><b>Agent's explanation</b>${esc(p.justification)}</div>
    <div style="margin:.75rem 0">${riskHtml(p.risk_score)}</div>
    ${p.risk_reasons?.length ? `<ul class="reasons">${p.risk_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    <h2 style="margin-top:1rem">Guardrail checks</h2>
    ${checksHtml(p.checks)}
    ${p.payout_batch_id ? `<p class="small muted">PayPal payout batch <b>${esc(p.payout_batch_id)}</b>: ${esc(p.payout_status)}</p>` : ''}
    ${p.error ? `<p class="small" style="color:var(--bad)">${esc(p.error)}</p>` : ''}`;
  $('detail').showModal();
}

// ---------------- PayPal Checkout top-up ----------------
async function setupPayPal() {
  const { clientId } = await api('GET', '/api/paypal/client-id');
  if (!clientId) { $('paypal-msg').textContent = 'Add PAYPAL_CLIENT_ID to .env to enable top-ups.'; return; }
  const s = document.createElement('script');
  // Sandbox SDK: with a sandbox client ID this can only ever move test money.
  s.src = `https://www.sandbox.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
  s.onload = () => {
    paypal.Buttons({
      style: { layout: 'horizontal', tagline: false, height: 40 },
      createOrder: async () => (await api('POST', '/api/topup/create', { amount: $('topup-amount').value })).id,
      onApprove: async (data) => {
        const r = await api('POST', `/api/topup/${data.orderID}/capture`);
        toast(`Added ${money(r.amountCents)} to the allowance`);
        refreshAll();
      },
      onError: (err) => toast(`PayPal error: ${err?.message || err}`),
    }).render('#paypal-buttons');
  };
  s.onerror = () => { $('paypal-msg').textContent = 'Could not load PayPal buttons.'; };
  document.head.appendChild(s);
}

async function refreshStatus() {
  const st = await api('GET', '/api/status');
  $('model').textContent = st.lastModel ? `AI: ${st.lastModel.model}` : st.aiConfigured ? `AI: ${st.aiModel}` : 'AI key missing';
}

// ---------------- polling ----------------
function refreshAll() {
  return Promise.all([refreshState(), refreshPayments(), refreshEvents()]).catch((e) => console.warn(e));
}
refreshAll();
refreshStatus();
setupPayPal();
setInterval(() => refreshEvents().catch(() => {}), 1000);
setInterval(() => { refreshState().catch(() => {}); refreshPayments().catch(() => {}); }, 2000);
setInterval(() => refreshStatus().catch(() => {}), 5000);
