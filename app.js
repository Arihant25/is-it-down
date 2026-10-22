const RAW = 'https://raw.githubusercontent.com/Arihant25/is-it-down/';
const NETS = {
  lan: {
    label: 'LAN', subject: 'The LAN', the: 'the LAN', base: `${RAW}data/`,
    where: 'Measured from a Raspberry Pi in Bakul Nivas.', off: 'The monitor may also have lost power.',
  },
  wifi: {
    label: 'Wi-Fi', subject: 'Wi-Fi', the: 'Wi-Fi', base: `${RAW}data-wifi/`,
    where: 'Measured from a test machine on wifi@iiith.', off: 'The test machine may also be switched off.',
  },
};
const STALE_AFTER = 20 * 60; // monitors publish every 5 min; raw.githubusercontent caches up to 5 more
const TZ = 'Asia/Kolkata';
const IST_OFFSET = 19800;
const MAX_DAYS = 90;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const $ = id => document.getElementById(id);
const nowSec = () => Math.floor(Date.now() / 1000);
const state = { lan: null, wifi: null, net: initialNet() };
const cur = () => state[state.net];

function initialNet() {
  if (location.hash === '#wifi') return 'wifi';
  try { if (localStorage.getItem('net') === 'wifi') return 'wifi'; } catch {}
  return 'lan';
}

const fmt = opts => ts => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour12: false, ...opts }).format(ts * 1000);
const fmtTime = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtFull = fmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = fmt({ day: 'numeric', month: 'short' });
const fmtClock = fmt({ hour: '2-digit', minute: '2-digit' });

function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return 'under a minute';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return `${d} d${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${m} min`;
}
const ago = ts => nowSec() - ts < 60 ? 'just now' : `${fmtDur(nowSec() - ts)} ago`;
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmtPct = p => p >= 99.995 ? '100' : p.toFixed(2);
const istDayStart = ts => Math.floor((ts + IST_OFFSET) / 86400) * 86400 - IST_OFFSET;

async function getJSON(base, name, bust) {
  const r = await fetch(`${base}${name}?t=${bust}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

async function load(manual = false) {
  const btn = $('refresh');
  btn.classList.add('busy');
  // The first load reuses the fetches index.html started in <head>.
  const early = window.__data;
  window.__data = null;
  const bust = manual ? Date.now() : Math.floor(Date.now() / 30000);
  await Promise.all(Object.keys(NETS).map(async net => {
    try {
      const [status, outages, speed] = await ((early && early[net]) ||
        Promise.all(['status.json', 'outages.json', 'speed.json'].map(n => getJSON(NETS[net].base, n, bust))));
      state[net] = { status, outages, speed };
    } catch (e) {
      console.error(net, e); // keep the last good data for this network, if any
    }
  }));
  btn.classList.remove('busy');
  render();
}

function render() {
  for (const net of Object.keys(NETS)) renderAnswer(net);
  renderTitle();
  renderDetails();
}

const isStale = d => nowSec() - d.status.updated > STALE_AFTER;
const stateOf = d => !d ? 'loading' : isStale(d) ? 'stale' : d.status.up ? 'up' : 'down';

// ---------- the two answers ----------
function renderAnswer(net) {
  const n = NETS[net], d = state[net], box = $(`a-${net}`), now = nowSec();
  const q = sel => box.querySelector(sel);
  if (!d) {
    box.className = 'net loading error';
    q('.answer-detail').textContent = `Could not load the ${n.label} monitor’s data. Try refreshing in a minute.`;
    q('.answer-meta').textContent = '';
    return;
  }
  const s = d.status, sp = s.speed, cls = stateOf(d);
  let word, detail, meta;
  if (cls === 'stale') {
    word = 'Probably.';
    detail = `No report from the ${n.label} monitor for ${fmtDur(now - s.updated)}, so it’s most likely down. ${n.off}`;
    meta = `Last report at ${fmtTime(s.updated)}`;
  } else if (cls === 'up') {
    word = 'No.';
    const parts = [sp && `${sp.down.toFixed(1)} Mbps download speed`, sp && `${sp.up.toFixed(1)} upload speed`,
      s.latency_ms != null && `${Math.round(s.latency_ms)} ms ping`].filter(Boolean);
    detail = `${n.subject} is up${parts.length ? `: ${parts.join(', ')}` : ''}.`;
    meta = `Up for ${fmtDur(now - s.since)} · checked ${ago(s.last_probe)}`;
  } else {
    word = 'Yes.';
    detail = `${n.subject} has been down for ${fmtDur(now - s.since)}, since ${fmtClock(s.since)}.`;
    meta = `Checked ${ago(s.last_probe)}`;
  }
  box.className = `net ${cls}`;
  q('.answer-word').textContent = word;
  q('.answer-detail').textContent = detail;
  q('.answer-meta').textContent = meta;
}

function renderTitle() {
  const word = { up: 'up', down: 'down', stale: 'probably down', loading: '…' };
  document.title = `LAN ${word[stateOf(state.lan)]} · Wi-Fi ${word[stateOf(state.wifi)]} · Is It Down? IIIT Hyderabad`;
}

// ---------- network switch and the sections below it ----------
function setNet(net) {
  state.net = net;
  try { localStorage.setItem('net', net); } catch {}
  history.replaceState(null, '', net === 'wifi' ? '#wifi' : location.pathname + location.search);
  renderDetails();
}

function renderDetails() {
  for (const b of document.querySelectorAll('.switch button')) b.setAttribute('aria-selected', b.dataset.net === state.net);
  const d = cur(), n = NETS[state.net];
  $('details').className = stateOf(d);
  $('hourly-sub').textContent = `Average ${n.label} speed for each hour of the day (IST), across all speed tests.`;
  $('heat-sub').textContent = `Share of each hour of the week ${n.the} was down, across all history (IST).`;
  if (!d) {
    $('speed-note').textContent = `No data from the ${NETS[state.net].label} monitor yet.`;
    return;
  }
  renderTiles();
  renderHourly();
  renderBars();
  renderHeat();
  renderTable();
  $('footer-updated').textContent = `${NETS[state.net].label} monitoring since ${fmtFull(d.status.monitoring_since)}`;
}

// ---------- tiles with sparklines ----------
function renderTiles() {
  const d = cur(), s = d.status, sp = s.speed;
  $('t-down').innerHTML = sp ? `${sp.down.toFixed(1)}<small>Mbps</small>` : '–';
  $('t-up').innerHTML = sp ? `${sp.up.toFixed(1)}<small>Mbps</small>` : '–';
  $('t-ping').innerHTML = s.latency_ms != null ? `${Math.round(s.latency_ms)}<small>ms</small>` : '–';
  $('speed-note').textContent = NETS[state.net].where + (sp ? ` Speed last tested ${ago(sp.ts)}.` : '');

  const recent = d.speed.recent;
  sparkline($('s-down'), recent.map(r => [r.ts, r.down]), v => `${v.toFixed(1)} Mbps`);
  sparkline($('s-up'), recent.map(r => [r.ts, r.up]), v => `${v.toFixed(1)} Mbps`);
  sparkline($('s-ping'), s.ping_24h || [], v => `${Math.round(v)} ms`);
}

const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

function sparkline(svg, pts, fmtVal) {
  svg.replaceChildren();
  svg.onpointermove = svg.onpointerdown = svg.onpointerleave = null;
  const W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !pts.length) return;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const max = Math.max(...pts.map(p => p[1])) * 1.1 || 1;
  const X = t => t1 === t0 ? W / 2 : 2 + (t - t0) / (t1 - t0) * (W - 4);
  const Y = v => H - 2 - v / max * (H - 4);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  if (pts.length > 1) {
    el('path', { class: 'area', d: `${line}L${X(t1)},${H}L${X(t0)},${H}Z` }, svg);
    el('path', { class: 'line', d: line }, svg);
  }
  const dot = el('circle', { r: 4, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
  const place = p => { dot.setAttribute('cx', X(p[0])); dot.setAttribute('cy', Y(p[1])); };
  place(pts[pts.length - 1]);
  svg.onpointermove = ev => {
    const r = svg.getBoundingClientRect();
    const t = t0 + (ev.clientX - r.left - 2) / (W - 4) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    place(best);
    showTip(ev, `<b>${fmtTime(best[0])}</b><br>${fmtVal(best[1])}`);
  };
  svg.onpointerdown = svg.onpointermove; // a tap shows the tooltip on touch screens
  svg.onpointerleave = () => { place(pts[pts.length - 1]); hideTip(); };
}

// ---------- average speed by hour of day ----------
const hh = h => String(h).padStart(2, '0');

// The monitors publish all-time hourly averages; fall back to the last 7 days of raw tests.
function hourlyStats() {
  const sp = cur().speed;
  if (sp.hourly) return sp.hourly;
  const acc = {};
  for (const r of sp.recent) {
    const h = Math.floor((r.ts + IST_OFFSET) % 86400 / 3600);
    const a = acc[h] ||= { hour: h, down: 0, up: 0, n: 0 };
    a.down += r.down; a.up += r.up; a.n++;
  }
  return Object.values(acc).map(a => ({ hour: a.hour, down: a.down / a.n, up: a.up / a.n, n: a.n }));
}

// A bar with rounded top corners, anchored to the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(3, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderHourly() {
  const box = $('hourly');
  box.replaceChildren();
  const W = box.clientWidth, H = box.clientHeight;
  if (!W) return;
  const byHour = new Array(24).fill(null);
  for (const r of hourlyStats()) byHour[r.hour] = r;
  const m = { t: 8, r: 4, b: 22, l: 34 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` }, box);
  const filled = byHour.filter(Boolean);
  const yMax = niceMax(Math.max(10, ...filled.map(r => Math.max(r.down, r.up))) * 1.05);
  const Y = v => H - m.b - v / yMax * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / 24;
  const grid = el('g', { class: 'grid' }, svg), axis = el('g', { class: 'axis' }, svg);
  for (let i = 0; i <= 4; i++) {
    const v = yMax * i / 4;
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, grid);
    el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, axis).textContent = +v.toFixed(1);
  }
  const every = W < 500 ? 6 : 3;
  for (let h = 0; h < 24; h += every)
    el('text', { x: m.l + h * slot, y: H - 6 }, axis).textContent = hh(h);

  const gap = 2, bw = Math.max(2, (slot - 4 - gap) / 2);
  const hovers = [];
  for (let h = 0; h < 24; h++) {
    const x0 = m.l + h * slot, r = byHour[h];
    hovers.push(el('rect', { class: 'hover', x: x0, y: m.t, width: slot, height: H - m.t - m.b, rx: 3 }, svg));
    if (!r) {
      el('line', { class: 'empty-mark', x1: x0 + 3, x2: x0 + slot - 3, y1: H - m.b, y2: H - m.b }, svg);
      continue;
    }
    const bx = x0 + 2;
    el('path', { d: barPath(bx, Y(r.down), bw, H - m.b - Y(r.down)), fill: 'var(--s1)' }, svg);
    el('path', { d: barPath(bx + bw + gap, Y(r.up), bw, H - m.b - Y(r.up)), fill: 'var(--s2)' }, svg);
  }
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const move = ev => {
    const rc = svg.getBoundingClientRect();
    const h = Math.min(23, Math.max(0, Math.floor((ev.clientX - rc.left - m.l) / slot)));
    hovers.forEach((e, i) => e.classList.toggle('on', i === h));
    const r = byHour[h];
    showTip(ev, `<b>${hh(h)}:00–${hh((h + 1) % 24)}:00</b><br>` + (r
      ? `Download ${r.down.toFixed(1)} Mbps<br>Upload ${r.up.toFixed(1)} Mbps<br>${r.n} test${r.n === 1 ? '' : 's'}`
      : 'No tests in this hour yet'));
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { hovers.forEach(e => e.classList.remove('on')); hideTip(); });

  // Name the fastest and slowest hours once enough of the day is covered.
  const solid = filled.filter(r => r.n >= 2);
  if (solid.length >= 12) {
    const best = solid.reduce((a, b) => b.down > a.down ? b : a), worst = solid.reduce((a, b) => b.down < a.down ? b : a);
    $('hourly-summary').textContent = `Fastest around ${hh(best.hour)}:00 (${best.down.toFixed(0)} Mbps download), ` +
      `slowest around ${hh(worst.hour)}:00 (${worst.down.toFixed(0)} Mbps).`;
  } else {
    $('hourly-summary').textContent = `${filled.length} of 24 hours have speed tests so far.`;
  }
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// ---------- daily uptime bars (grow from the first monitored day) ----------
function renderBars() {
  const d = cur(), s = d.status, now = nowSec();
  const today = istDayStart(now);
  const first = Math.max(istDayStart(s.monitoring_since), today - (MAX_DAYS - 1) * 86400);
  const html = [];
  for (let d0 = first; d0 <= today; d0 += 86400) {
    const d1 = Math.min(d0 + 86400, now), w0 = Math.max(d0, s.monitoring_since);
    let down = 0, off = 0;
    for (const o of d.outages) {
      const ov = overlap(o.start, o.end ?? now, w0, d1);
      if (o.kind === 'down') down += ov; else off += ov;
    }
    const known = d1 - w0 - off;
    let cls = 'none', tip;
    if (known <= 0) {
      tip = `<b>${fmtDay(d0)}</b><br>No data (monitor offline)`;
    } else {
      cls = down === 0 ? 'good' : 'bad';
      tip = `<b>${fmtDay(d0)}</b><br>` + (down ? `${icon('x')}Down for ${fmtDur(down)}` : `${icon('check')}No downtime`) +
        `<br>${fmtPct(100 * (known - down) / known)}% uptime` + (off >= 60 ? `<br>Monitor offline ${fmtDur(off)}` : '');
    }
    html.push(`<div class="bar ${cls}" data-tip="${tip.replace(/"/g, '&quot;')}"></div>`);
  }
  $('bars').innerHTML = html.join('');
  $('bars-axis').innerHTML = first === today ? '<span>Today</span>' : `<span>${fmtDay(first)}</span><span>Today</span>`;
  $('uptime-stats').innerHTML = [['24h', '24 h'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']]
    .map(([k, l]) => `<span>${l} <b>${s.uptime[k] != null ? fmtPct(s.uptime[k]) + '%' : '–'}</b></span>`).join('');
}

// ---------- hour-of-week downtime heatmap ----------
const bucketOf = ts => {
  const local = ts + IST_OFFSET;
  return ((Math.floor(local / 86400) + 3) % 7) * 24 + Math.floor(local % 86400 / 3600); // Mon 00:00 = 0
};

// Spread [a, b) over hour-of-week buckets.
function addSpan(arr, a, b) {
  for (let h = Math.floor(a / 3600) * 3600; h < b; h += 3600) arr[bucketOf(h)] += overlap(a, b, h, h + 3600);
}

function renderHeat() {
  const d = cur(), s = d.status, now = nowSec();
  const known = new Array(168).fill(0), down = new Array(168).fill(0);
  addSpan(known, s.monitoring_since, now);
  for (const o of d.outages) {
    const end = o.end ?? now;
    if (o.kind === 'down') addSpan(down, o.start, end);
    else { const off = new Array(168).fill(0); addSpan(off, o.start, end); off.forEach((v, i) => known[i] -= v); }
  }
  const frac = known.map((k, i) => k >= 600 ? down[i] / k : null);
  const maxFrac = Math.max(0, ...frac.filter(f => f != null));
  const shade = f => f > 0
    ? `color-mix(in oklab, var(--s1) ${Math.round(30 + 70 * f / maxFrac)}%, var(--cell-zero))` : '';

  const html = ['<span></span>'];
  for (let h = 0; h < 24; h++) html.push(`<span class="hour">${h % 6 === 0 ? hh(h) : ''}</span>`);
  for (let day = 0; day < 7; day++) {
    html.push(`<span class="day">${DAY_NAMES[day]}</span>`);
    for (let h = 0; h < 24; h++) {
      const i = day * 24 + h, f = frac[i];
      const range = `${DAY_NAMES[day]} ${hh(h)}:00–${hh((h + 1) % 24)}:00`;
      const tip = f == null ? `<b>${range}</b><br>No data yet`
        : `<b>${range}</b><br>${f ? `Down ${(100 * f).toFixed(1)}% of the time<br>${fmtDur(down[i])} in total` : 'Never down'}`;
      html.push(`<div class="cell${f == null ? ' nodata' : ''}" style="${f ? `background:${shade(f)}` : ''}" data-tip="${tip}"></div>`);
    }
  }
  $('heat').innerHTML = html.join('');
  $('ramp').innerHTML = [0, 0.25, 0.5, 0.75, 1].map(f =>
    `<i style="background:${f ? `color-mix(in oklab, var(--s1) ${Math.round(30 + 70 * f)}%, var(--cell-zero))` : 'var(--cell-zero)'}"></i>`).join('');
}

// ---------- outage table ----------
function renderTable() {
  const showOff = $('show-offline').checked, now = nowSec();
  const rows = cur().outages.filter(o => showOff || o.kind === 'down').slice().reverse();
  $('outages').innerHTML = rows.length ? rows.map(o => {
    const ongoing = o.end == null;
    const cls = ongoing ? 'ongoing' : o.kind === 'offline' ? 'offline' : '';
    const label = o.kind === 'offline' ? ' <span title="The monitor itself was offline">· monitor offline</span>' : '';
    return `<tr class="${cls}"><td>${fmtFull(o.start)}</td><td>${ongoing ? 'Ongoing' : fmtFull(o.end)}</td>` +
      `<td>${fmtDur((o.end ?? now) - o.start)}${label}</td></tr>`;
  }).join('') : '<tr><td class="empty" colspan="3">No outages recorded yet</td></tr>';
}

// ---------- tooltip ----------
function showTip(ev, html) {
  const tip = $('tooltip');
  tip.innerHTML = html;
  tip.classList.add('show');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + 12, y = ev.clientY - h - 12;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 12;
  if (y < 8) y = ev.clientY + 16;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
const hideTip = () => $('tooltip').classList.remove('show');
for (const id of ['bars', 'heat']) {
  const onPointer = ev => {
    const t = ev.target.closest('[data-tip]');
    if (t) showTip(ev, t.dataset.tip); else hideTip();
  };
  $(id).addEventListener('pointermove', onPointer);
  $(id).addEventListener('pointerdown', onPointer);
  $(id).addEventListener('pointerleave', hideTip);
}

for (const b of document.querySelectorAll('.switch button')) b.addEventListener('click', () => setNet(b.dataset.net));
$('refresh').addEventListener('click', () => load(true));
$('show-offline').addEventListener('change', () => cur() && renderTable());
// Tapping anywhere else dismisses a tooltip opened by touch.
document.addEventListener('pointerdown', ev => {
  if (!ev.target.closest('[data-tip], .spark, .hourly')) hideTip();
});
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (cur()) { renderTiles(); renderHourly(); } }, 150); });

// Poll once a minute while the tab is visible; keep the "for X min" text ticking in between.
let timer = null;
function startPolling() { clearInterval(timer); timer = setInterval(load, 60000); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(timer); timer = null; } else { load(); startPolling(); }
});
setInterval(() => {
  if (document.hidden) return;
  for (const net of Object.keys(NETS)) if (state[net]) renderAnswer(net);
  renderTitle();
}, 15000);
renderDetails(); // reflect the remembered network in the switch before data arrives
load();
startPolling();
