const DATA = 'https://raw.githubusercontent.com/Arihant25/is-it-down/data/';
const STALE_AFTER = 20 * 60; // monitor publishes every 5 min; raw.githubusercontent caches up to 5 more
const TZ = 'Asia/Kolkata';
const IST_OFFSET = 19800;
const MAX_DAYS = 90;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const $ = id => document.getElementById(id);
const nowSec = () => Math.floor(Date.now() / 1000);
let state = { status: null, outages: [], speed: { recent: [], daily: [] } };

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

async function getJSON(name, bust) {
  const r = await fetch(`${DATA}${name}?t=${bust}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

async function load(manual = false) {
  const btn = $('refresh');
  btn.classList.add('busy');
  try {
    // The first load reuses the fetch index.html started in <head>.
    const early = window.__data;
    window.__data = null;
    const bust = manual ? Date.now() : Math.floor(Date.now() / 30000);
    const [status, outages, speed] = await (early ||
      Promise.all(['status.json', 'outages.json', 'speed.json'].map(n => getJSON(n, bust))));
    state = { status, outages, speed };
  } catch (e) {
    console.error(e);
    if (!state.status) {
      document.body.className = 'loading';
      $('answer-word').textContent = '…';
      $('answer-detail').textContent = 'Could not load the monitor’s data. Try refreshing in a minute.';
      return;
    }
  } finally {
    btn.classList.remove('busy');
  }
  render();
}

function render() {
  renderAnswer();
  renderTiles();
  renderBars();
  renderHeat();
  renderTable();
  const s = state.status;
  $('footer-updated').textContent = `Monitoring since ${fmtFull(s.monitoring_since)}`;
}

// ---------- the answer ----------
function renderAnswer() {
  const s = state.status, now = nowSec();
  const stale = now - s.updated > STALE_AFTER;
  const sp = s.speed;
  let cls, word, detail, meta;
  if (stale) {
    cls = 'stale'; word = 'Probably.';
    detail = `No report from the monitor for ${fmtDur(now - s.updated)}, so the LAN is most likely down. ` +
      'The monitor may also have lost power.';
    meta = `Last report at ${fmtTime(s.updated)}`;
  } else if (s.up) {
    cls = 'up'; word = 'No.';
    const parts = [sp && `${sp.down.toFixed(1)} Mbps download speed`, sp && `${sp.up.toFixed(1)} upload speed`,
      s.latency_ms != null && `${Math.round(s.latency_ms)} ms ping`].filter(Boolean);
    detail = `The LAN is up${parts.length ? `: ${parts.join(', ')}` : ''}.`;
    meta = `Up for ${fmtDur(now - s.since)} · checked ${ago(s.last_probe)}`;
  } else {
    cls = 'down'; word = 'Yes.';
    detail = `The LAN has been down for ${fmtDur(now - s.since)}, since ${fmtClock(s.since)}.`;
    meta = `Checked ${ago(s.last_probe)}`;
  }
  document.body.className = cls;
  $('answer-word').textContent = word;
  $('answer-detail').textContent = detail;
  $('answer-meta').textContent = meta;
  document.title = `${stale ? 'Probably down' : s.up ? 'Up' : 'Down'} · Is It Down? IIIT Hyderabad LAN`;
}

// ---------- tiles with sparklines ----------
function renderTiles() {
  const s = state.status, sp = s.speed;
  $('t-down').innerHTML = sp ? `${sp.down.toFixed(1)}<small>Mbps</small>` : '–';
  $('t-up').innerHTML = sp ? `${sp.up.toFixed(1)}<small>Mbps</small>` : '–';
  $('t-ping').innerHTML = s.latency_ms != null ? `${Math.round(s.latency_ms)}<small>ms</small>` : '–';
  const u = s.uptime['30d'];
  $('t-uptime').innerHTML = u != null ? `${fmtPct(u)}<small>%</small>` : '–';
  const days = Math.ceil((nowSec() - s.monitoring_since) / 86400);
  $('t-uptime-caption').textContent = days < 30 ? `Since ${fmtDay(s.monitoring_since)}` : 'Last 30 days';
  $('speed-note').textContent = 'Measured from a Raspberry Pi in Bakul Nivas.' +
    (sp ? ` Speed last tested ${ago(sp.ts)}.` : '');

  const recent = state.speed.recent;
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
  svg.onpointermove = svg.onpointerleave = null;
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
  svg.onpointerleave = () => { place(pts[pts.length - 1]); hideTip(); };
}

// ---------- daily uptime bars (grow from the first monitored day) ----------
function renderBars() {
  const s = state.status, now = nowSec();
  const today = istDayStart(now);
  const first = Math.max(istDayStart(s.monitoring_since), today - (MAX_DAYS - 1) * 86400);
  const html = [];
  for (let d0 = first; d0 <= today; d0 += 86400) {
    const d1 = Math.min(d0 + 86400, now), w0 = Math.max(d0, s.monitoring_since);
    let down = 0, off = 0;
    for (const o of state.outages) {
      const ov = overlap(o.start, o.end ?? now, w0, d1);
      if (o.kind === 'down') down += ov; else off += ov;
    }
    const known = d1 - w0 - off;
    let cls = 'none', tip;
    if (known <= 0) {
      tip = `<b>${fmtDay(d0)}</b><br>No data (monitor offline)`;
    } else {
      cls = down === 0 ? 'good' : down < 3600 ? 'warn' : 'bad';
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
  const s = state.status, now = nowSec();
  const known = new Array(168).fill(0), down = new Array(168).fill(0);
  addSpan(known, s.monitoring_since, now);
  for (const o of state.outages) {
    const end = o.end ?? now;
    if (o.kind === 'down') addSpan(down, o.start, end);
    else { const off = new Array(168).fill(0); addSpan(off, o.start, end); off.forEach((v, i) => known[i] -= v); }
  }
  const frac = known.map((k, i) => k >= 600 ? down[i] / k : null);
  const maxFrac = Math.max(0, ...frac.filter(f => f != null));
  const shade = f => f > 0
    ? `color-mix(in oklab, var(--s1) ${Math.round(30 + 70 * f / maxFrac)}%, var(--cell-zero))` : '';

  const html = ['<span></span>'];
  for (let h = 0; h < 24; h++) html.push(`<span class="hour">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>`);
  for (let d = 0; d < 7; d++) {
    html.push(`<span class="day">${DAY_NAMES[d]}</span>`);
    for (let h = 0; h < 24; h++) {
      const i = d * 24 + h, f = frac[i];
      const range = `${DAY_NAMES[d]} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
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
  const rows = state.outages.filter(o => showOff || o.kind === 'down').slice().reverse();
  $('outages').innerHTML = rows.length ? rows.map(o => {
    const ongoing = o.end == null;
    const cls = ongoing ? 'ongoing' : o.kind === 'offline' ? 'offline' : '';
    const label = o.kind === 'offline' ? ' <span title="The monitor itself was offline (power cut or reboot)">· monitor offline</span>' : '';
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
  $(id).addEventListener('pointermove', ev => {
    const t = ev.target.closest('[data-tip]');
    if (t) showTip(ev, t.dataset.tip); else hideTip();
  });
  $(id).addEventListener('pointerleave', hideTip);
}

$('refresh').addEventListener('click', () => load(true));
$('show-offline').addEventListener('change', () => state.status && renderTable());
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.status && renderTiles(), 150); });

// Poll once a minute while the tab is visible; keep the "for X min" text ticking in between.
let timer = null;
function startPolling() { clearInterval(timer); timer = setInterval(load, 60000); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(timer); timer = null; } else { load(); startPolling(); }
});
setInterval(() => !document.hidden && state.status && renderAnswer(), 15000);
load();
startPolling();
