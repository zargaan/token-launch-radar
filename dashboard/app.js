// Token Launch Radar dashboard — renders window.RADAR, no network.
const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const money = (n) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n / 1e3) + 'K';
const pct = (n) => (n === null || n === undefined) ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('asof').textContent = D.as_of;
$('counts').textContent = `${D.board_size} ranked protocols · ${D.watchlist_size} on the watchlist · ${D.live_size} live-token protocols for comparison.`;

// Category filter options, biggest first.
const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
for (const c of cats) {
  const o = document.createElement('option');
  o.value = c; o.textContent = c;
  $('cat').appendChild(o);
}

let sandbox = { gw: 0.5, cc: 0.6, of: 0.2 };
let sandboxOn = false;

function impliedWith(r) {
  if (!sandboxOn) return r.implied_value_usd;
  const comp = Math.min(r.comp_raw, sandbox.cc);
  const rate = Math.max(r.odds_rate, sandbox.of);
  const odds = rate * r.maturity_multiplier;
  const growth = 1 + (Math.min(100, Math.max(-50, r.growth_pct)) / 100) * sandbox.gw;
  return Math.max(1, Math.round(r.tvl_usd * comp * odds * growth));
}

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('cat').value;
  const wl = $('wl').checked;
  let rows = D.rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!cat || r.category === cat) &&
    (!wl || r.watchlist));
  const sort = $('sort').value;
  const val = (r) => sandboxOn ? impliedWith(r) : r.implied_value_usd;
  rows = [...rows].sort((a, b) =>
    sort === 'tvl' ? b.tvl_usd - a.tvl_usd :
    sort === 'growth' ? (b.change_7d ?? -999) - (a.change_7d ?? -999) :
    val(b) - val(a));
  return rows;
}

function render() {
  const rows = filtered();
  $('result-count').textContent = `${rows.length} of ${D.board_size} protocols${sandboxOn ? ' — sandbox assumptions applied, board.json unchanged' : ''}.`;
  $('rows').innerHTML = rows.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td>${r.rank}</td>
    <td><span class="name">${esc(r.name)}</span><br><span class="slug">${esc(r.slug)}</span>${r.watchlist ? '<span class="badge">watchlist</span>' : ''}</td>
    <td>${esc(r.category || '—')}</td><td>${esc(r.chains.slice(0, 2).join(', ') || '—')}</td>
    <td class="num">${money(r.tvl_usd)}</td><td class="num">${pct(r.change_7d)}</td>
    <td class="num">${r.comp_multiple.toFixed(2)}</td><td class="num">${r.launch_odds.toFixed(2)}</td>
    <td class="num"><strong>${money(impliedWith(r))}</strong></td></tr>`).join('');
  document.querySelectorAll('#rows tr').forEach((tr) =>
    tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
  renderSandboxTop();
}

function renderSandboxTop() {
  if (!sandboxOn) { $('sandbox-top').textContent = 'Move a slider to re-rank the board under different assumptions.'; return; }
  const top = [...D.rows].sort((a, b) => impliedWith(b) - impliedWith(a)).slice(0, 3);
  $('sandbox-top').textContent = 'Sandbox top 3: ' + top.map((r, i) => `${i + 1}. ${r.name} ${money(impliedWith(r))}`).join(' · ');
}

function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  const breakdown = `${money(r.tvl_usd)} TVL × ${r.comp_multiple.toFixed(2)} comp × ${r.launch_odds.toFixed(2)} odds × ${r.growth_multiplier.toFixed(2)} growth = ${money(r.implied_value_usd)}`;
  $('detail').hidden = false;
  $('detail').innerHTML = `<button class="close" id="detail-close">Close</button>
    <h2>${esc(r.name)}</h2>
    <p class="muted">#${r.rank} · ${esc(r.category || 'uncategorised')} · ${esc(r.chains.join(', ') || '—')} · ${r.watchlist ? 'on the watchlist' : 'below the watchlist floor'} · snapshot ${esc(D.as_of)}</p>
    <h3>Value breakdown</h3>
    <p><strong>${esc(breakdown)}</strong></p>
    <table><tbody>
      <tr><th>TVL</th><td class="num">${money(r.tvl_usd)}</td></tr>
      <tr><th>Comp (category median mcap/TVL)</th><td class="num">${r.comp_multiple.toFixed(2)}</td></tr>
      <tr><th>Launch odds (category token rate ${Math.round(r.odds_rate * 100)}% × maturity ${r.maturity_multiplier.toFixed(2)})</th><td class="num">${r.launch_odds.toFixed(2)}</td></tr>
      <tr><th>Growth (7d ${pct(r.change_7d)})</th><td class="num">× ${r.growth_multiplier.toFixed(2)}</td></tr>
      <tr><th>Implied value</th><td class="num"><strong>${money(r.implied_value_usd)}</strong></td></tr>
    </tbody></table>
    <h3>Farm plan</h3>
    <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <h3>Doubts — what could make this rank wrong</h3>
    <div class="flags">${r.flags.map((f) => `<p>• ${esc(f)}</p>`).join('')}</div>
    <h3>What would change this rank</h3>
    <p>A token announcement in the snapshot's own terms would remove it from the board. A 7-day TVL swing moves the growth tilt; a new category peer with a token moves the comp. Try the sandbox on the Model tab.</p>`;
  $('detail-close').addEventListener('click', () => { $('detail').hidden = true; });
}

function showTab(name) {
  for (const t of ['board', 'live', 'model']) {
    $('view-' + t).hidden = t !== name;
    $('tab-' + t).classList.toggle('active', t === name);
  }
  if (name === 'live') renderLive();
}
$('tab-board').addEventListener('click', () => showTab('board'));
$('tab-live').addEventListener('click', () => showTab('live'));
$('tab-model').addEventListener('click', () => showTab('model'));

function renderLive() {
  $('live-rows').innerHTML = D.live.map((r) => `<tr>
    <td><span class="name">${esc(r.name)}</span><br><span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category || '—')}</td><td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${r.mcap_usd === null ? '—' : money(r.mcap_usd)}</td>
    <td class="num">${r.mcap_usd === null ? '—' : (r.mcap_usd / r.tvl_usd).toFixed(2)}</td>
    <td class="num">${pct(r.change_7d)}</td></tr>`).join('');
}

for (const id of ['q', 'cat', 'sort', 'wl']) $(id).addEventListener('input', render);

function bindSandbox(id, key, label, fmt) {
  $(id).addEventListener('input', (e) => {
    sandbox[key] = parseFloat(e.target.value);
    sandboxOn = true;
    $(label).textContent = fmt(sandbox[key]);
    render();
  });
}
bindSandbox('gw', 'gw', 'gw-val', (v) => v.toFixed(2));
bindSandbox('cc', 'cc', 'cc-val', (v) => v.toFixed(2));
bindSandbox('of', 'of', 'of-val', (v) => v.toFixed(2));
$('sandbox-reset').addEventListener('click', () => {
  sandbox = { gw: 0.5, cc: 0.6, of: 0.2 }; sandboxOn = false;
  $('gw').value = '0.5'; $('cc').value = '0.6'; $('of').value = '0.2';
  $('gw-val').textContent = '0.50'; $('cc-val').textContent = '0.60'; $('of-val').textContent = '0.20';
  render();
});

// Deep links for screenshots and sharing a view: #detail=<slug>, #filter=watchlist.
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('filter') === 'watchlist') $('wl').checked = true;
render();
if (hash.get('detail')) openDetail(hash.get('detail'));
