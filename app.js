const DATA = 'https://raw.githubusercontent.com/Arihant25/is-it-down/data/';
const STALE_AFTER = 20 * 60; // monitor publishes every 5 min; raw.githubusercontent caches up to 5 more
const TZ = 'Asia/Kolkata';
const IST_OFFSET = 19800;
const DAYS = 90;

const $ = id => document.getElementById(id);
const nowSec = () => Math.floor(Date.now() / 1000);
let state = { status: null, outages: [], speed: { recent: [], daily: [] }, range: '7d' };

const fmtTime = ts => new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(ts * 1000);
const fmtFull = ts => new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(ts * 1000);
const fmtHour = ts => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(ts * 1000);
const fmtDay = ts => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' }).format(ts * 1000);

function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return '<1 min';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return `${d} d${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${m} min`;
}
const ago = ts => `${fmtDur(nowSec() - ts)} ago`;
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

async function getJSON(name) {
  const r = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 30000)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

async function load() {
  try {
    // The first load reuses the fetch index.html started in <head>.
    const early = window.__data;
    window.__data = null;
    const [status, outages, speed] = await (early ||
      Promise.all(['status.json', 'outages.json', 'speed.json'].map(getJSON)));
    state = { ...state, status, outages, speed };
  } catch (e) {
    console.error(e);
    if (!state.status) {
      setHero('loading', 'No data yet', 'Could not load the monitor’s data. Try again in a few minutes.');
      return;
    }
  }
  render();
}

function setHero(cls, title, detail) {
  $('hero').className = `hero ${cls}`;
  $('hero-title').textContent = title;
  $('hero-detail').textContent = detail;
}

function render() {
  const s = state.status, now = nowSec();
  const stale = now - s.updated > STALE_AFTER;

  if (stale) {
    setHero('stale', 'Probably down',
      `No report from the monitor for ${fmtDur(now - s.updated)} (last at ${fmtTime(s.updated)}). ` +
      `It reports every 5 minutes, so the LAN is most likely down — or the monitor lost power.`);
  } else if (s.up) {
    setHero('up', 'LAN is up', `Up for ${fmtDur(now - s.since)} · checked ${ago(s.last_probe)}`);
  } else {
    setHero('down', 'LAN is down', `Down since ${fmtTime(s.since)} (${fmtDur(now - s.since)}) · checked ${ago(s.last_probe)}`);
  }
  document.title = stale ? 'Probably down · Is It Down?' : s.up ? 'Up · Is It Down?' : 'Down · Is It Down?';

  const sp = s.speed;
  $('t-down').innerHTML = sp ? `${sp.down.toFixed(1)}<small>Mbps</small>` : '–';
  $('t-up').innerHTML = sp ? `${sp.up.toFixed(1)}<small>Mbps</small>` : '–';
  $('t-ping').innerHTML = s.latency_ms != null ? `${Math.round(s.latency_ms)}<small>ms</small>` : '–';
  const u = s.uptime['30d'];
  $('t-uptime').innerHTML = u != null ? `${fmtPct(u)}<small>%</small>` : '–';
  $('speed-note').textContent = sp
    ? `Speed tested every 3 hours, last ${ago(sp.ts)} via ${sp.server}. Ping is to 1.1.1.1, checked every minute.`
    : 'Speed is tested every 3 hours; no result yet.';

  $('uptime-stats').innerHTML = [['24h', '24 h'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']]
    .map(([k, l]) => `<span>${l} <b>${s.uptime[k] != null ? fmtPct(s.uptime[k]) + '%' : '–'}</b></span>`).join('');

  renderBars();
  renderChart();
  renderTable();
  $('footer-updated').textContent = `Monitoring since ${fmtFull(s.monitoring_since)} · data updated ${ago(s.updated)}`;
}

const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmtPct = p => p >= 99.995 ? '100' : p.toFixed(2);

// ---------- daily uptime bars ----------
function renderBars() {
  const s = state.status, now = nowSec();
  const todayStart = Math.floor((now + IST_OFFSET) / 86400) * 86400 - IST_OFFSET;
  const html = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d0 = todayStart - i * 86400, d1 = Math.min(d0 + 86400, now);
    const w0 = Math.max(d0, s.monitoring_since);
    let cls = 'none', tip;
    if (d1 <= s.monitoring_since) {
      tip = `${fmtDay(d0)}<br>No data`;
    } else {
      let down = 0, off = 0;
      for (const o of state.outages) {
        const ov = overlap(o.start, o.end ?? now, w0, d1);
        if (o.kind === 'down') down += ov; else off += ov;
      }
      const known = d1 - w0 - off;
      if (known <= 0) {
        tip = `${fmtDay(d0)}<br>No data (monitor offline)`;
      } else {
        cls = down === 0 ? 'good' : down < 3600 ? 'warn' : 'bad';
        tip = `<b>${fmtDay(d0)}</b><br>` + (down ? `${icon('x')}Down for ${fmtDur(down)}` : `${icon('check')}No downtime`) +
          `<br>${(100 * (known - down) / known).toFixed(2)}% uptime` +
          (off >= 60 ? `<br>Monitor offline ${fmtDur(off)}` : '');
      }
    }
    html.push(`<div class="bar ${cls}" data-tip="${tip.replace(/"/g, '&quot;')}"></div>`);
  }
  $('bars').innerHTML = html.join('');
}

// ---------- speed chart ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function niceMax(v) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function chartPoints() {
  if (state.range === '7d') return state.speed.recent.map(r => ({ ts: r.ts, down: r.down, up: r.up }));
  return state.speed.daily.map(r => {
    const [y, m, d] = r.day.split('-').map(Number);
    return { ts: Date.UTC(y, m - 1, d, 12) / 1000 - IST_OFFSET, down: r.down, up: r.up, daily: true };
  });
}

function renderChart() {
  const box = $('chart');
  box.innerHTML = '';
  const W = box.clientWidth, H = box.clientHeight;
  const m = { t: 10, r: 72, b: 24, l: 40 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Download and upload speed over time' }, box);
  const pts = chartPoints();
  if (!pts.length) {
    el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' }, svg).textContent = 'No speed tests yet';
    return;
  }
  let x0 = pts[0].ts, x1 = pts[pts.length - 1].ts;
  if (x1 - x0 < 3600) { const mid = (x0 + x1) / 2; x0 = mid - 43200; x1 = mid + 43200; }
  const yMax = niceMax(Math.max(...pts.map(p => Math.max(p.down, p.up))) * 1.05);
  const X = t => m.l + (t - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = v => H - m.b - v / yMax * (H - m.t - m.b);

  const grid = el('g', { class: 'grid' }, svg), axis = el('g', { class: 'axis' }, svg);
  for (let i = 0; i <= 4; i++) {
    const v = yMax * i / 4, y = Y(v);
    el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y }, grid);
    el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, axis).textContent = +v.toFixed(1);
  }
  const ticks = Math.max(2, Math.min(7, Math.floor((W - m.l - m.r) / 90)));
  for (let i = 0; i <= ticks; i++) {
    const t = x0 + (x1 - x0) * i / ticks;
    el('text', { x: X(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, axis)
      .textContent = x1 - x0 < 2 * 86400 ? fmtHour(t) : fmtDay(t);
  }

  const series = [['down', 'var(--s1)', 'Download'], ['up', 'var(--s2)', 'Upload']];
  for (const [k, color] of series) {
    el('path', {
      d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.ts).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(''),
      fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }, svg);
  }
  // markers while data is sparse, so single tests are visible
  if (pts.length <= 60) for (const [k, color] of series) for (const p of pts)
    el('circle', { cx: X(p.ts), cy: Y(p[k]), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
  // direct labels on the latest values, nudged apart if they collide
  const last = pts[pts.length - 1];
  let yd = Y(last.down) + 4, yu = Y(last.up) + 4;
  if (Math.abs(yd - yu) < 13) { const mid = (yd + yu) / 2; [yd, yu] = last.down >= last.up ? [mid - 7, mid + 7] : [mid + 7, mid - 7]; }
  el('text', { x: X(last.ts) + 8, y: yd, class: 'dl' }, svg).textContent = `Down ${last.down.toFixed(0)}`;
  el('text', { x: X(last.ts) + 8, y: yu, class: 'dl' }, svg).textContent = `Up ${last.up.toFixed(0)}`;

  // hover: crosshair + markers + tooltip on the nearest test
  const hover = el('g', { visibility: 'hidden' }, svg);
  const cross = el('line', { class: 'crosshair', y1: m.t, y2: H - m.b }, hover);
  const dots = series.map(([, c]) => el('circle', { r: 4.5, fill: c, stroke: 'var(--surface)', 'stroke-width': 2 }, hover));
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r + 8, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const tip = $('tooltip');
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const t = x0 + (ev.clientX - r.left - m.l) / (W - m.l - m.r) * (x1 - x0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.ts - t) < Math.abs(best.ts - t)) best = p;
    const cx = X(best.ts);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
    dots[0].setAttribute('cx', cx); dots[0].setAttribute('cy', Y(best.down));
    dots[1].setAttribute('cx', cx); dots[1].setAttribute('cy', Y(best.up));
    hover.setAttribute('visibility', 'visible');
    showTip(ev, `<b>${best.daily ? fmtDay(best.ts) + ' (daily avg)' : fmtTime(best.ts)}</b><br>` +
      `Download ${best.down.toFixed(1)} Mbps<br>Upload ${best.up.toFixed(1)} Mbps`);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.classList.remove('show'); });
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
$('bars').addEventListener('pointermove', ev => {
  const b = ev.target.closest('.bar');
  if (b) showTip(ev, b.dataset.tip); else $('tooltip').classList.remove('show');
});
$('bars').addEventListener('pointerleave', () => $('tooltip').classList.remove('show'));

document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  state.range = b.dataset.range;
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-selected', x === b));
  if (state.status) renderChart();
}));
$('show-offline').addEventListener('change', () => state.status && renderTable());
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.status && renderChart(), 150); });

// Poll once a minute, but only while the tab is visible.
let timer = null;
function startPolling() { clearInterval(timer); timer = setInterval(load, 60000); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(timer); timer = null; } else { load(); startPolling(); }
});
load();
startPolling();
