import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const S = {
  games: [], memos: {}, news: {}, free: null, steamFree: null, gogFree: null, achsum: {}, ach: {}, shots: {}, history: {},
  acc: { steamKey: false, steamId: null, epic: null },
  user: { collections: [], favorites: [], hidden: [], closeToTray: true, autostart: false, notify: true, autoBackup: true, backupDir: null },
  friends: null, wishlist: null,
  view: 'home', sel: null, q: '', src: 'all', col: 'Tout', sort: 'recent',
  tab: 'ach', achF: 'all', openNews: 0, menu: null, sub: null, showSoft: false, busy: false, modal: null, homeY: 0,
};
const $ = (s) => document.querySelector(s);
const P = (() => {
  const d = { wp: 'auto', wpGame: '', wpBlur: 0, wpDim: 45, big: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(P)); } catch { /* ignore */ } };
let wpPath = null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SRC = { steam: 'Steam', epic: 'Epic', gog: 'GOG' };
const CAT = {
  Tout: '#FF6B9A', Favoris: '#FFD45C', Installés: '#6EE7A8', 'Mises à jour': '#FFB020', 'Avec mémo': '#FFE08A', Survie: '#3EE6A8', 'Souls-like': '#FF6B6B',
  Roguelite: '#FF9F43', Metroidvania: '#A78BFA', Horreur: '#FF5C7A', Coop: '#4CBCE6', Multijoueur: '#5B9DFF', Solo: '#F5C84C', RPG: '#F5B84C',
  Chill: '#C97CF0', Incrémental: '#7CE0F0', Puzzle: '#7BC74D', Plateformes: '#FFB86B', 'Monde ouvert': '#34D399', Construction: '#F59E0B',
  Stratégie: '#60A5FA', Simulation: '#2DD4BF', Tir: '#F87171', Course: '#FB923C', Rythme: '#E879F9', Aventure: '#FBBF24', Action: '#FB7185',
  Démo: '#94A3B8', Logiciel: '#7C9CFF', Masqués: '#8B8B96',
};
const PALETTE = ['#FF6B9A', '#5B9DFF', '#3EE6A8', '#FFB020', '#C97CF0', '#FF6B6B', '#2DD4BF', '#F5C84C'];
const isCustom = (c) => c.startsWith('c:');
const catColor = (c) => (isCustom(c) ? (S.user.collections.find((x) => 'c:' + x.name === c)?.color || '#FF6B9A') : CAT[c] || '#B8C2D6');
const lbl = (c) => (c === 'Logiciel' ? 'Apps' : isCustom(c) ? c.slice(2) : c);

// ---------- images: resized on the Rust side to the displayed size ----------
const IMG = 'http://img.localhost/';
const dpr = () => window.devicePixelRatio || 1;
const TW = () => (dpr() > 1.3 ? 440 : 300);
const bgW = () => [1280, 1920, 2560, 3840].find((w) => w >= innerWidth * dpr()) || 3840;
const th = (u, w) => (u ? `${IMG}t?w=${w}&u=${encodeURIComponent(u)}` : '');
const loc = (p, w) => (p ? `${IMG}f?w=${w}&p=${encodeURIComponent(p)}` : '');
const coverSrc = (g) => th(g.cover, TW());

const fmtH = (m) => {
  if (!m) return '—';
  const h = m / 60;
  return h < 10 ? `${h.toFixed(1).replace('.', ',')} h` : `${Math.round(h).toLocaleString('fr-FR')} h`;
};
const size = (b) => (b ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : '—');
function ago(ts) {
  if (!ts) return 'Jamais';
  const d = (Date.now() / 1000 - ts) / 86400;
  if (d < 1) return "Aujourd'hui";
  if (d < 2) return 'Hier';
  if (d < 7) return `Il y a ${Math.floor(d)} j`;
  if (d < 30) return `Il y a ${Math.floor(d / 7)} sem.`;
  return new Date(ts * 1000).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
const day = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const I = (d, w = 18) => `<svg aria-hidden="true" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const icon = {
  play: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  dl: I('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', 20),
  opts: I('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 20),
  pen: I('<path d="M4 20h4L20 8l-4-4L4 16z"/>', 16),
  chev: '<svg class="chev" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  right: I('<path d="M9 6l6 6-6 6"/>', 14),
  check: '<svg class="ck" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  star: (on) => `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
  upd: I('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 14),
};

const cur = () => S.games.find((g) => g.id === S.sel) || null;
const isSoft = (g) => g.tags.includes('Logiciel');
const isHidden = (g) => S.user.hidden.includes(g.id);
const isFav = (g) => S.user.favorites.includes(g.id);
const visible = () => S.games.filter((g) => (S.col === 'Masqués' ? isHidden(g) : !isHidden(g)) && (!isSoft(g) || S.showSoft || S.col === 'Logiciel'));
const pct = (id) => { const s = S.achsum[id]; return s && s[1] ? Math.round((s[0] / s[1]) * 100) : null; };
const saveUser = () => invoke('set_user', { u: S.user }).catch((e) => toast(String(e)));

function toast(msg) {
  const t = $('#toast');
  t.className = 'solid on';
  t.innerHTML = `<span class="dot"></span>${esc(msg)}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'solid'), 3200);
}
function hexDeep(hex) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const f = (v) => Math.round(v * 0.12 + 6).toString(16).padStart(2, '0');
  return `#${f(n >> 16 & 255)}${f(n >> 8 & 255)}${f(n & 255)}`;
}
function theme(a, d) {
  const r = document.documentElement.style;
  r.setProperty('--a', a || '#B8C2D6');
  r.setProperty('--d', d || hexDeep(a));
}
function setBg(src, blur, custom) {
  const img = $('#bg-img');
  document.body.classList.toggle('wp', !!custom);
  img.classList.toggle('blur', !!blur && !custom);
  img.style.filter = custom ? `blur(${P.wpBlur}px)` : '';
  img.style.transform = custom && P.wpBlur ? 'scale(1.06)' : '';
  document.documentElement.style.setProperty('--dim', String(P.wpDim / 100));
  if (img.dataset.src === (src || '')) return;
  img.dataset.src = src || '';
  if (!src) { img.removeAttribute('src'); return; }
  img.classList.add('loading');
  img.onload = () => img.classList.remove('loading');
  img.src = src;
}
// blurred backgrounds don't need full resolution
const bgSrc = (g, blur) => th(g?.hero || g?.cover, blur ? 960 : bgW());

// ---------- shared pieces ----------

function renderTop() {
  const base = S.games.filter((g) => !isSoft(g) && !isHidden(g));
  const counts = { all: base.length };
  for (const k of Object.keys(SRC)) counts[k] = base.filter((g) => g.source === k).length;
  const items = [['all', 'Tout']].concat(Object.entries(SRC).filter(([k]) => counts[k] > 0));
  $('#sources').innerHTML = items.map(([k, l]) =>
    `<button data-act="src" data-v="${k}" aria-pressed="${S.src === k}">${l}<span class="n">${counts[k]}</span></button>`).join('');
  $('#back').hidden = S.view === 'home';
  $('#stats-btn').setAttribute('aria-pressed', String(S.view === 'stats'));
  const on = (S.friends || []).filter((f) => f.game).length;
  $('#friends-badge').hidden = !on;
  $('#friends-badge').textContent = on;
}

function cover(g) {
  const memo = S.memos[g.id];
  const p = pct(g.id);
  return `<button class="cov${g.installed ? '' : ' notinst'}" data-act="sel" data-id="${esc(g.id)}" aria-label="${esc(g.name)}" style="--g:${g.accent || '#000'}">
    <span class="art" style="background:${g.deep || '#1A1A20'}">
      <span class="ph">${esc(g.name)}</span>
      ${g.cover ? `<img src="${esc(coverSrc(g))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
      <span class="badges">${g.update ? `<span class="srcb upd">${icon.upd}MAJ</span>` : ''}${g.source !== 'steam' ? `<span class="srcb">${SRC[g.source].toUpperCase()}</span>` : ''}</span>
      ${memo || isFav(g) ? `<span class="memob">${isFav(g) ? `<span style="color:#FFD45C">${icon.star(true)}</span>` : icon.pen}</span>` : ''}
      ${p !== null ? `<span class="pb"><span style="width:${p}%;background:${p === 100 ? '#6EE7A8' : g.accent || '#fff'}"></span></span>` : ''}
    </span>
    <span class="meta"><span class="nm">${esc(g.name)}</span><span class="h">${g.playtimeMin ? fmtH(g.playtimeMin) : ''}</span></span>
  </button>`;
}

// ---------- virtual grid (only rows on screen exist in the DOM) ----------

const VG = { list: [], cols: 1, rowH: 300, first: -1, last: -1 };
function mountGrid(list) {
  VG.list = list; VG.first = VG.last = -1;
  if (!$('#vgrid')) return;
  layoutGrid(); paintGrid(true);
}
function layoutGrid() {
  const host = $('#vgrid'); if (!host) return;
  const W = host.clientWidth || innerWidth - 112;
  const min = P.big ? 210 : 150; const gap = 20; const rowGap = 24;
  VG.cols = Math.max(1, Math.floor((W + gap) / (min + gap)));
  const itemW = (W - gap * (VG.cols - 1)) / VG.cols;
  VG.cellH = Math.ceil(itemW * 1.5 + 9 + 20);
  VG.rowH = VG.cellH + rowGap;
  host.style.height = `${Math.max(0, Math.ceil(VG.list.length / VG.cols) * VG.rowH - rowGap)}px`;
}
function paintGrid(force) {
  const host = $('#vgrid'); if (!host || S.view !== 'home') return;
  const top = host.getBoundingClientRect().top + scrollY;
  const rows = Math.ceil(VG.list.length / VG.cols);
  const first = Math.max(0, Math.floor((scrollY - top) / VG.rowH) - 2);
  const last = Math.min(rows, Math.ceil((scrollY + innerHeight - top) / VG.rowH) + 2);
  if (!force && first === VG.first && last === VG.last) return;
  VG.first = first; VG.last = last;
  const items = VG.list.slice(first * VG.cols, last * VG.cols);
  host.innerHTML = items.length ? `<div class="grid" style="position:absolute;left:0;right:0;top:${first * VG.rowH}px;grid-template-columns:repeat(${VG.cols},minmax(0,1fr));grid-auto-rows:${VG.cellH}px">${items.map(cover).join('')}</div>` : '';
}
addEventListener('scroll', () => paintGrid(), { passive: true });
addEventListener('resize', () => { if ($('#vgrid')) { layoutGrid(); paintGrid(true); } });

// ---------- HOME ----------

function inCol(g, c) {
  if (c === 'Tout' || c === 'Masqués') return true;
  if (c === 'Favoris') return isFav(g);
  if (c === 'Installés') return g.installed;
  if (c === 'Mises à jour') return g.update;
  if (c === 'Avec mémo') return !!S.memos[g.id];
  if (isCustom(c)) return !!S.user.collections.find((x) => 'c:' + x.name === c)?.ids.includes(g.id);
  return g.tags.includes(c);
}

function collections() {
  const pool = S.games.filter((g) => !isHidden(g) && (S.src === 'all' || g.source === S.src));
  const base = pool.filter((g) => !isSoft(g) || S.showSoft);
  const counts = {};
  base.forEach((g) => g.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const list = ['Tout'];
  if (pool.some(isFav)) list.push('Favoris');
  S.user.collections.forEach((c) => list.push('c:' + c.name));
  list.push('Installés');
  if (pool.some((g) => g.update)) list.push('Mises à jour');
  if (pool.some(isSoft)) list.push('Logiciel');
  if (pool.some((g) => S.memos[g.id])) list.push('Avec mémo');
  Object.entries(counts).filter(([t, n]) => n >= 2 && t !== 'Logiciel' && t !== 'Démo').sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([t]) => list.push(t));
  if (counts['Démo']) list.push('Démo');
  if (S.user.hidden.length) list.push('Masqués');
  const rank = (a, b) => b.lastPlayed - a.lastPlayed || b.playtimeMin - a.playtimeMin;
  return list.map((c) => {
    const src = c === 'Logiciel' ? pool.filter(isSoft) : c === 'Masqués' ? S.games.filter(isHidden) : base;
    const inside = src.filter((g) => inCol(g, c)).sort(rank);
    return { c, n: inside.length, art: inside.filter((g) => g.cover).slice(0, 3) };
  });
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  let l = visible().filter((g) => (S.src === 'all' || g.source === S.src) && inCol(g, S.col));
  if (q) l = l.filter((g) => g.name.toLowerCase().includes(q) || g.tags.some((t) => lbl(t).toLowerCase().includes(q)) || (S.memos[g.id] || '').toLowerCase().includes(q));
  const by = {
    recent: (a, b) => b.lastPlayed - a.lastPlayed || b.playtimeMin - a.playtimeMin || a.name.localeCompare(b.name, 'fr'),
    hours: (a, b) => b.playtimeMin - a.playtimeMin,
    az: (a, b) => a.name.localeCompare(b.name, 'fr'),
    pct: (a, b) => (pct(b.id) ?? -1) - (pct(a.id) ?? -1),
    size: (a, b) => b.size - a.size,
  };
  return l.sort(by[S.sort]);
}
const SORTS = [['recent', 'Joués récemment'], ['hours', 'Temps de jeu'], ['pct', 'Complétion des succès'], ['az', 'Alphabétique'], ['size', 'Taille sur disque']];

const normN = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Every free-to-keep offer, all stores, flagged when already in the library. */
function freeItems() {
  const owned = (store, name, appid) => S.games.some((g) => (appid && g.steamAppid === appid && g.source === 'steam') || (g.source === store && normN(g.name) === normN(name)));
  const epic = (S.free || []).map((x) => ({ store: 'Epic', name: x.title, img: x.image, url: x.url, until: x.until, upcoming: x.upcoming, owned: !x.upcoming && owned('epic', x.title) }));
  const steam = (S.steamFree || []).map((d) => ({ store: 'Steam', name: d.name, img: d.cover, url: `https://store.steampowered.com/app/${d.appid}`, until: '', upcoming: false, owned: owned('steam', d.name, d.appid) }));
  const gog = (S.gogFree || []).map((x) => ({ store: 'GOG', name: x.title, img: x.image, url: x.url, until: '', upcoming: false, owned: owned('gog', x.title) }));
  return [...epic, ...steam, ...gog];
}
const untilTxt = (x) => (x.until ? `${x.upcoming ? 'À partir du' : "Jusqu'au"} ${new Date(x.until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : '');

function dealsRow() {
  const w = (S.wishlist || []).filter((d) => d.discount > 0).slice(0, 12);
  const free = freeItems().filter((x) => !x.upcoming).sort((a, b) => a.owned - b.owned);
  if (!w.length && !free.length) return '';
  return `<section class="deals-wrap">
    <div class="cols-head"><div><h2>Bons plans</h2><span class="muted">Jeux offerts sur Epic, Steam et GOG, et promos de ta liste de souhaits Steam</span></div></div>
    <div class="deals">
      ${free.map((d) => `<button class="deal glass${d.owned ? ' owned' : ''}" data-act="url" data-v="${esc(d.url)}">
        <span class="dimg">${d.img ? `<img src="${esc(th(d.img, 360))}" alt="" loading="lazy">` : ''}<span class="store">${d.store}</span></span>
        <span class="dt"><b>${esc(d.name)}</b>${d.owned ? '<span class="tagown">DÉJÀ À TOI</span>' : '<span class="tagfree">GRATUIT</span>'}<span class="muted" style="font-size:12px">${esc(untilTxt(d))}</span></span></button>`).join('')}
      ${w.map((d) => `<button class="deal glass" data-act="url" data-v="https://store.steampowered.com/app/${d.appid}">
        <span class="dimg">${d.cover ? `<img src="${esc(th(d.cover, 360))}" alt="" loading="lazy">` : ''}<span class="off">-${d.discount} %</span></span>
        <span class="dt"><b>${esc(d.name)}</b><span><s class="muted">${esc(d.original)}</s> <strong>${esc(d.price)}</strong></span></span></button>`).join('')}
    </div></section>`;
}

function renderHome() {
  const all = S.games.filter((g) => !isSoft(g) && !isHidden(g));
  const total = all.reduce((s, g) => s + g.playtimeMin, 0);
  const bySrc = Object.keys(SRC).map((k) => [k, all.filter((g) => g.source === k).reduce((s, g) => s + g.playtimeMin, 0)]).filter(([, v]) => v > 0);
  const sums = Object.entries(S.achsum).filter(([id]) => all.some((g) => g.id === id)).map(([, v]) => v);
  const un = sums.reduce((s, v) => s + v[0], 0), tot = sums.reduce((s, v) => s + v[1], 0);
  const perfect = sums.filter((v) => v[1] && v[0] === v[1]).length;
  const updates = all.filter((g) => g.update).length;
  const last = [...all].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  const col = S.col;
  theme(catColor(col));
  const wpG = P.wp === 'game' && S.games.find((x) => x.id === P.wpGame);
  if (P.wp === 'file' && wpPath) setBg(loc(wpPath, P.wpBlur > 8 ? 1280 : bgW()), false, true);
  else if (wpG) setBg(th(wpG.hero || wpG.cover, P.wpBlur > 8 ? 1280 : bgW()), false, true);
  else setBg(bgSrc(last, true), true);
  const cols = collections();
  const list = filtered();
  const lastMemo = last && S.memos[last.id];

  $('#home').innerHTML = `
    <section class="home-head">
      <div>
        <h1>Ta bibliothèque</h1>
        <div class="sub">${all.length} jeux · ${all.filter((g) => g.installed).length} installés${updates ? ` · <button class="alink" data-act="col" data-v="Mises à jour" style="min-height:0;display:inline">${updates} mise${updates > 1 ? 's' : ''} à jour</button>` : ''}${S.busy ? ' · mise à jour…' : ''}</div>
      </div>
      <div class="kpis glass">
        <div><span class="k">TEMPS DE JEU TOTAL</span><span class="v">${fmtH(total)}</span>
          <span class="muted" style="font-size:12px">${bySrc.map(([k, v]) => `${SRC[k]} ${fmtH(v)}`).join(' · ') || '—'}</span></div>
        <div><span class="k">SUCCÈS</span><span class="v">${tot ? un.toLocaleString('fr-FR') : '—'}${tot ? `<small>/ ${tot.toLocaleString('fr-FR')}</small>` : ''}</span>
          ${tot ? `<span class="bar"><span style="width:${Math.round((un / tot) * 100)}%"></span></span>` : `<button class="alink" data-act="settings" style="min-height:0">Relier Steam / Epic →</button>`}</div>
        <div><span class="k">JEUX À 100 %</span><span class="v">${tot ? perfect : '—'}</span></div>
      </div>
    </section>

    ${last ? `<button class="resume" data-act="sel" data-id="${esc(last.id)}" style="--a:${last.accent || 'var(--a)'}">
      ${last.hero || last.cover ? `<img class="h" src="${esc(th(last.hero || last.cover, Math.min(bgW(), 2560)))}" alt="">` : ''}
      <span class="fade"></span>
      <span class="in">
        ${last.logo ? `<img class="lg" src="${esc(th(last.logo, 640))}" alt="${esc(last.name)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'nm',textContent:${esc(JSON.stringify(last.name))}}))">` : `<span class="nm">${esc(last.name)}</span>`}
        <span class="meta">
          <span class="k"><span class="dot" style="background:${last.accent};box-shadow:0 0 12px ${last.accent}"></span>REPRENDRE · ${esc(ago(last.lastPlayed).toUpperCase())}</span>
          <span>${fmtH(last.playtimeMin)} de jeu${pct(last.id) !== null ? ` · ${pct(last.id)} % des succès` : ''}</span>
          ${lastMemo ? `<span class="memo">✎ ${esc(lastMemo)}</span>` : ''}
        </span>
        <span class="play sm go" data-act="play-id" data-id="${esc(last.id)}" style="background:${last.accent}">${last.installed ? icon.play + 'Jouer' : icon.dl + 'Installer'}</span>
      </span>
    </button>` : ''}

    <section class="cols-wrap">
      <div class="cols-head"><div><h2>Collections</h2><span class="muted">Automatiques (tags Steam) et les tiennes</span></div>
        <button class="btn2" data-act="newcol">+ Nouvelle collection</button></div>
      <div class="cols" role="group" aria-label="Collections">
        ${cols.map((x) => `<button class="col" data-act="col" data-v="${esc(x.c)}" aria-pressed="${x.c === col}" style="--c:${catColor(x.c)}">
          <span class="fan">
            ${x.art[1] ? `<img class="f1" src="${esc(th(x.art[1].cover, 200))}" alt="" loading="lazy">` : ''}
            ${x.art[2] ? `<img class="f3" src="${esc(th(x.art[2].cover, 200))}" alt="" loading="lazy">` : ''}
            ${x.art[0] ? `<img class="f2" src="${esc(th(x.art[0].cover, 220))}" alt="" loading="lazy">` : ''}
          </span>
          <span class="lbl"><b>${esc(lbl(x.c))}</b><span>${x.n}</span></span>
        </button>`).join('')}
      </div>
    </section>

    ${dealsRow()}

    <section class="lib" id="lib">
      <div class="sec-head">
        <div><h2>${col === 'Tout' ? 'Tous les jeux' : esc(lbl(col))}</h2><span class="muted">${list.length} jeu${list.length > 1 ? 'x' : ''}${S.q ? ` pour « ${esc(S.q)} »` : ''}</span></div>
        <div class="row2">
          ${isCustom(col) ? `<button class="btn2" data-act="delcol" data-v="${esc(col)}">Supprimer la collection</button>` : ''}
          <div class="anchor">
            <button class="glass pillbtn" data-act="menu" data-menu="sort" aria-expanded="${S.menu === 'sort'}">
              ${I('<path d="M4 6h16M7 12h10M10 18h4"/>', 16)} Trier : <strong>${SORTS.find((s) => s[0] === S.sort)[1]}</strong></button>
            ${S.menu === 'sort' ? `<div class="menu solid" role="menu" style="right:0;top:54px">
              <span class="mh">TRIER PAR</span>
              ${SORTS.map(([k, l]) => `<button class="mi" role="menuitemradio" aria-checked="${S.sort === k}" data-act="sort" data-v="${k}">${l}${S.sort === k ? icon.check : ''}</button>`).join('')}
              <div class="sep"></div><span class="mh">AFFICHER</span>
              <button class="mi" data-act="soft">${S.showSoft ? 'Masquer' : 'Afficher'} les apps dans « Tout »<span class="r">${S.games.filter(isSoft).length}</span></button>
            </div>` : ''}
          </div>
        </div>
      </div>
      ${list.length ? '<div id="vgrid" class="vgrid"></div>' : `<div class="grid"><div class="empty">${S.games.length ? 'Aucun jeu ne correspond.' : S.busy ? 'Analyse de Steam, Epic et GOG…' : 'Aucun jeu détecté.'}</div></div>`}
    </section>`;
  mountGrid(list);
}

// ---------- GAME ----------

async function ensureNews(g) {
  if (!g?.steamAppid || S.news[g.steamAppid]) return;
  S.news[g.steamAppid] = [];
  try { S.news[g.steamAppid] = await invoke('news', { appid: g.steamAppid }); } catch { /* offline */ }
  if (S.view === 'game' && cur()?.steamAppid === g.steamAppid) renderGame();
}
async function ensureAch(g, force) {
  if (!g || (S.ach[g.id] && !force)) return;
  S.ach[g.id] = null;
  try { S.ach[g.id] = await invoke('achievements', { id: g.id }); } catch (e) { S.ach[g.id] = { unlocked: 0, total: 0, list: [], note: String(e) }; }
  if (S.view === 'game' && S.sel === g.id) renderGame();
}
async function ensureShots(g) {
  if (!g || S.shots[g.id]) return;
  try { S.shots[g.id] = await invoke('screenshots', { id: g.id }); } catch { S.shots[g.id] = []; }
  if (S.view === 'game' && S.sel === g.id) renderGame();
}

function optsMenu(g) {
  const st = g.source === 'steam' && g.steamAppid;
  const inCols = S.user.collections;
  return `<div class="menu solid" role="menu" style="left:0;bottom:72px;min-width:280px">
    <span class="mh">${esc(g.name.toUpperCase())}</span>
    <button class="mi" data-act="fav">${icon.star(isFav(g))}${isFav(g) ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button>
    <div class="subwrap">
      <button class="mi" data-act="sub" data-v="cols">Ajouter à une collection<span class="r">${icon.right}</span></button>
      ${S.sub === 'cols' ? `<div class="menu solid submenu" role="menu">
        <span class="mh">MES COLLECTIONS</span>
        ${inCols.map((c) => `<button class="mi" role="menuitemcheckbox" aria-checked="${c.ids.includes(g.id)}" data-act="togcol" data-v="${esc(c.name)}"><span class="cdot" style="background:${c.color}"></span>${esc(c.name)}${c.ids.includes(g.id) ? icon.check : ''}</button>`).join('') || '<span class="muted" style="padding:8px 12px">Aucune collection</span>'}
        <div class="sep"></div><button class="mi" data-act="newcol" data-v="${esc(g.id)}">+ Nouvelle collection</button>
      </div>` : ''}
    </div>
    <button class="mi" data-act="tab" data-v="memo">Écrire un mémo</button>
    <div class="sep"></div>
    ${g.installed ? `<button class="mi" data-act="backup">Sauvegarder mes parties</button>` : ''}
    ${g.installed && g.installPath ? '<button class="mi" data-act="folder">Ouvrir le dossier du jeu</button>' : ''}
    <div class="subwrap">
      <button class="mi" data-act="sub" data-v="manage">Gérer<span class="r">${icon.right}</span></button>
      ${S.sub === 'manage' ? `<div class="menu solid submenu" role="menu">
        ${st && !g.installed ? `<button class="mi" data-act="url" data-v="steam://install/${g.steamAppid}">Installer</button>` : ''}
        ${st && g.update ? `<button class="mi" data-act="url" data-v="steam://nav/downloads">Mettre à jour (téléchargements Steam)</button>` : ''}
        ${st && g.installed ? `<button class="mi" data-act="url" data-v="steam://validate/${g.steamAppid}">Vérifier l'intégrité des fichiers</button>` : ''}
        ${st && g.installed ? `<button class="mi danger" data-act="url" data-v="steam://uninstall/${g.steamAppid}">Désinstaller…</button>` : ''}
        ${g.source === 'epic' ? `<button class="mi" data-act="url" data-v="com.epicgames.launcher://store/library">Gérer dans Epic Games</button>` : ''}
        ${st ? `<button class="mi" data-act="url" data-v="steam://nav/games/details/${g.steamAppid}">Voir dans Steam</button>` : ''}
        ${g.steamAppid ? `<button class="mi" data-act="url" data-v="https://store.steampowered.com/app/${g.steamAppid}">Page Steam du jeu</button>` : ''}
        <div class="sep"></div>
        <button class="mi" data-act="hide">${isHidden(g) ? 'Ne plus masquer ce jeu' : 'Masquer ce jeu de la bibliothèque'}</button>
      </div>` : ''}
    </div>
    <button class="mi" data-act="reach">Recharger les succès</button>
  </div>`;
}

function achPanel(g) {
  const a = S.ach[g.id];
  if (a === undefined || a === null) return '<div class="empty">Chargement des succès…</div>';
  const note = a.note ? `<div class="note">${esc(a.note)}${/Paramètres|clé|Connecte/.test(a.note) ? ' <button class="btn2 pri" data-act="settings">Ouvrir les paramètres</button>' : ''}</div>` : '';
  if (!a.total) return `<div style="padding-top:20px">${note || '<div class="empty">Aucun succès pour ce jeu.</div>'}</div>`;
  const p = Math.round((a.unlocked / a.total) * 100);
  let l = a.list;
  if (S.achF === 'got') l = l.filter((x) => x.unlocked);
  if (S.achF === 'todo') l = l.filter((x) => !x.unlocked);
  if (S.achF === 'rare') l = [...l].filter((x) => x.rarity != null).sort((x, y) => x.rarity - y.rarity).slice(0, 20);
  if (S.achF === 'all') l = [...l].sort((x, y) => (y.unlocked - x.unlocked) || (y.unlockTime - x.unlockTime));
  const F = [['all', 'Tous'], ['got', 'Débloqués'], ['todo', 'À faire'], ['rare', 'Les plus rares']];
  return `<div class="ach-top">
      <div style="flex:1 1 360px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:baseline;gap:12px"><span class="big">${p} %</span><span class="muted" style="font-size:15px">${a.unlocked} / ${a.total} succès débloqués</span></div>
        <div class="bigbar"><span style="width:${p}%"></span></div>
        <span class="muted" style="font-size:12px">${a.total - a.unlocked ? `${a.total - a.unlocked} restants` : 'Jeu terminé à 100 % !'}</span>
      </div>
      <div class="fseg glass" role="group" aria-label="Filtrer">${F.map(([k, x]) => `<button data-act="achf" data-v="${k}" aria-pressed="${S.achF === k}">${x}</button>`).join('')}</div>
    </div>${note}
    <div class="achs">${l.map((x) => `<div class="ach${x.unlocked ? ' on' : ''}">
        ${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy">` : '<span style="width:52px;height:52px;border-radius:12px;background:#222;flex:none"></span>'}
        <span class="t"><b>${esc(x.name)}</b><span>${esc(x.desc)}</span></span>
        <span class="r">${x.rarity != null ? (x.rarity < 10 ? `<span class="rare">${x.rarity.toFixed(1).replace('.', ',')} %</span>` : `${Math.round(x.rarity)} % des joueurs`) : ''}<span>${x.unlocked ? (x.unlockTime ? day(x.unlockTime) : 'Débloqué') : 'Verrouillé'}</span></span>
      </div>`).join('') || '<div class="empty">Rien dans ce filtre.</div>'}</div>`;
}

function newsPanel(g) {
  const list = g.steamAppid ? S.news[g.steamAppid] : null;
  if (!g.steamAppid) return `<div class="empty">Pas de flux d'actus trouvé pour ${esc(g.name)}.</div>`;
  if (!list || !list.length) return `<div class="empty">${list ? 'Aucune annonce officielle récente.' : 'Chargement des actus…'}</div>`;
  return list.map((n, i) => `<div class="nrow">
      <button class="acc" data-act="news" data-v="${i}" aria-expanded="${S.openNews === i}">
        <span class="b ${i === 0 ? 'first' : ''}">${esc(ago(n.date))}</span>
        <span class="t"><span>${esc(n.title)}</span><span class="muted" style="font-size:13px">${esc(day(n.date))}</span></span>
        ${icon.chev}
      </button>
      ${S.openNews === i ? `<div class="nbody"><span>${esc(n.body || 'Pas de résumé.')}</span><button class="alink" data-act="url" data-v="${esc(n.url)}">Lire en entier ↗</button></div>` : ''}
    </div>`).join('');
}

function shotsPanel(g) {
  const l = S.shots[g.id];
  if (!l) return '<div class="empty">Chargement des captures…</div>';
  if (!l.length) return `<div class="empty">${g.source === 'steam' ? 'Aucune capture Steam pour ce jeu (touche F12 en jeu).' : 'Les captures ne sont disponibles que pour les jeux Steam.'}</div>`;
  const w = dpr() > 1.3 ? 720 : 480;
  return `<div class="shots">${l.map((p) => `<button class="shot" data-act="openfile" data-v="${esc(p)}" title="Ouvrir en grand"><img src="${esc(loc(p, w))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`;
}

function memoPanel(g) {
  const memo = S.memos[g.id] || '';
  return `<div class="memo-tab">
    <label for="memo-ta" style="font-size:15px;font-weight:600">Où j'en suis dans ${esc(g.name)}</label>
    <textarea id="memo-ta" rows="6" placeholder="Ex. : Acte 2, juste avant le boss. Penser à équiper l'arme de feu.">${esc(memo)}</textarea>
    <div class="qchips"><span class="muted">Ajouter :</span>
      ${['Boss suivant', 'Quête en cours', 'Build / équipement', 'À faire avec les amis'].map((x) => `<button class="qchip" data-act="quick" data-v="${x}">+ ${x}</button>`).join('')}
    </div>
    <div class="btns"><button class="save" data-act="save-memo">Enregistrer le mémo</button><span class="muted" id="memo-state">${memo ? 'Enregistré' : ''}</span></div>
  </div>`;
}

function renderGame() {
  const g = cur();
  if (!g) { goHome(); return; }
  theme(g.accent, g.deep);
  setBg(bgSrc(g, !g.hero), !g.hero);
  const memo = S.memos[g.id];
  const a = S.achsum[g.id];
  const p = pct(g.id);
  const n = g.steamAppid && S.news[g.steamAppid]?.[0];
  const playing = (S.friends || []).filter((f) => f.game && f.appid && f.appid === g.steamAppid);
  const similar = visible().filter((x) => x.id !== g.id && g.tags[0] && x.tags.includes(g.tags[0])).sort((x, y) => y.lastPlayed - x.lastPlayed || y.playtimeMin - x.playtimeMin).slice(0, 12);
  const tabs = [['ach', `Succès${a ? ` · ${a[0]}/${a[1]}` : ''}`], ['news', 'Actus & patch notes'], ['shots', 'Captures'], ['memo', 'Mémo']];
  const body = { ach: achPanel, news: newsPanel, shots: shotsPanel, memo: memoPanel }[S.tab](g);
  const title = g.logo
    ? `<img class="logo" src="${esc(th(g.logo, 900))}" alt="${esc(g.name)}" onerror="this.replaceWith(Object.assign(document.createElement('h1'),{className:'title',textContent:${esc(JSON.stringify(g.name))}}))">`
    : `<h1 class="title">${esc(g.name)}</h1>`;
  $('#game').innerHTML = `
    <section class="ghero">
      <div class="body">
        <div class="gmain">
          <span class="kicker"><span class="dot"></span>${g.update ? 'MISE À JOUR DISPONIBLE' : !g.installed ? 'NON INSTALLÉ' : memo ? 'REPRENDRE LA PARTIE' : g.lastPlayed ? 'DERNIÈRE SESSION · ' + ago(g.lastPlayed).toUpperCase() : 'DANS TA BIBLIOTHÈQUE'}</span>
          ${title}
          <div class="tags">
            <span class="tag glass">${SRC[g.source]}</span>
            ${g.tags.slice(0, 5).map((t) => `<button class="tag glass" data-act="gocol" data-v="${esc(t)}" style="color:${catColor(t)}">${esc(lbl(t))}</button>`).join('')}
          </div>
          <div class="btns">
            <button class="play" data-act="play">${g.installed ? icon.play + 'Jouer' : icon.dl + 'Installer'}</button>
            ${g.update && g.source === 'steam' ? `<button class="ghost glass" data-act="url" data-v="steam://nav/downloads">${icon.upd}Mettre à jour</button>` : ''}
            <button class="ibtn glass round" data-act="fav" aria-label="${isFav(g) ? 'Retirer des favoris' : 'Ajouter aux favoris'}" style="color:${isFav(g) ? '#FFD45C' : '#fff'}">${icon.star(isFav(g))}</button>
            <div class="anchor">
              <button class="ibtn glass round" data-act="menu" data-menu="opts" aria-label="Options du jeu" aria-expanded="${S.menu === 'opts'}">${icon.opts}</button>
              ${S.menu === 'opts' ? optsMenu(g) : ''}
            </div>
          </div>
          <div class="stats glass">
            <div><span class="k">TEMPS DE JEU</span><span class="v">${g.playtimeMin ? fmtH(g.playtimeMin) : g.source === 'steam' ? '—' : 'Pas encore suivi'}</span></div>
            <button data-act="tab" data-v="ach"><span class="k">SUCCÈS ›</span><span class="v">${a ? `${a[0]} / ${a[1]}<span class="minibar"><span style="width:${p}%"></span></span>` : '—'}</span></button>
            <div><span class="k">DERNIÈRE SESSION</span><span class="v">${ago(g.lastPlayed)}</span></div>
            <div><span class="k">TAILLE</span><span class="v">${g.installed ? size(g.size) : 'Non installé'}</span></div>
          </div>
        </div>
        <div class="gside">
          ${playing.length ? `<div class="card glass"><span class="k">EN JEU EN CE MOMENT</span>${playing.map((f) => `<span class="fr"><img src="${esc(f.avatar)}" alt="">${esc(f.name)}</span>`).join('')}</div>` : ''}
          ${memo ? `<div class="card glass"><span class="k">${icon.pen}MÉMO · OÙ J'EN SUIS</span><span class="memo">${esc(memo)}</span><button class="alink" data-act="tab" data-v="memo">Modifier le mémo ↓</button></div>`
            : `<button class="ibtn glass memo-add" data-act="tab" data-v="memo" aria-label="Écrire un mémo" title="Écrire un mémo">${icon.pen}</button>`}
          ${n ? `<button class="card glass newscard" data-act="tab" data-v="news"><span class="k">DERNIÈRE ANNONCE · ${esc(ago(n.date).toUpperCase())}</span><span class="t">${esc(n.title)}</span><span class="alink" style="min-height:0">Lire les notes →</span></button>` : ''}
        </div>
      </div>
    </section>
    <section class="wrap" id="panel">
      <div class="panel glass">
        <div class="tabs" role="tablist">${tabs.map(([k, x]) => `<button class="tab" role="tab" data-act="tab" data-v="${k}" aria-selected="${S.tab === k}">${x}</button>`).join('')}<span class="gname">${esc(g.name)}</span></div>
        ${body}
      </div>
    </section>
    ${similar.length ? `<section class="similar"><div class="sec-head"><div><h2>Aussi dans ${esc(lbl(g.tags[0]))}</h2></div><button class="alink" data-act="gocol" data-v="${esc(g.tags[0])}">Voir la collection →</button></div>
      <div class="grid row">${similar.map(cover).join('')}</div></section>` : ''}`;
}

// ---------- STATS ----------

function renderStats() {
  theme('#7C9CFF');
  setBg('', true);
  const all = S.games.filter((g) => !isSoft(g) && !isHidden(g));
  const played = all.filter((g) => g.playtimeMin > 0);
  const total = played.reduce((s, g) => s + g.playtimeMin, 0);
  const recent = all.reduce((s, g) => s + (g.recentMin || 0), 0);
  const top = [...played].sort((a, b) => b.playtimeMin - a.playtimeMin).slice(0, 12);
  const max = top[0]?.playtimeMin || 1;
  const byCat = {};
  played.forEach((g) => { const t = g.tags.find((x) => !['Solo', 'Multijoueur', 'Coop', 'Action', 'Aventure'].includes(x)) || g.tags[0] || 'Autre'; byCat[t] = (byCat[t] || 0) + g.playtimeMin; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const catMax = cats[0]?.[1] || 1;
  const bySrc = Object.keys(SRC).map((k) => [k, played.filter((g) => g.source === k).reduce((s, g) => s + g.playtimeMin, 0)]).filter(([, v]) => v);
  const year = new Date().getFullYear();
  const thisYear = all.filter((g) => g.lastPlayed && new Date(g.lastPlayed * 1000).getFullYear() === year);
  // daily minutes from snapshots
  const days = Object.keys(S.history).sort();
  const daily = [];
  for (let i = 1; i < days.length; i++) {
    const a = S.history[days[i - 1]], b = S.history[days[i]];
    let m = 0; for (const id in b) m += Math.max(0, b[id] - (a[id] || 0));
    daily.push([days[i], m]);
  }
  const last30 = daily.slice(-30);
  const dmax = Math.max(60, ...last30.map((d) => d[1]));
  let streak = 0; for (let i = daily.length - 1; i >= 0 && daily[i][1] > 0; i--) streak++;
  const recentTop = [...all].filter((g) => g.recentMin).sort((a, b) => b.recentMin - a.recentMin).slice(0, 6);
  $('#stats').innerHTML = `
    <section class="home-head"><div><h1>Statistiques</h1><div class="sub">Ton temps de jeu, toutes plateformes confondues</div></div>
      <div class="kpis glass">
        <div><span class="k">TOTAL</span><span class="v">${fmtH(total)}</span><span class="muted" style="font-size:12px">${(total / 60 / 24).toFixed(0)} jours de jeu cumulés</span></div>
        <div><span class="k">2 DERNIÈRES SEMAINES</span><span class="v">${recent ? fmtH(recent) : '—'}</span></div>
        <div><span class="k">JOUÉS EN ${year}</span><span class="v">${thisYear.length}</span></div>
        <div><span class="k">SÉRIE</span><span class="v">${streak}<small>jour${streak > 1 ? 's' : ''}</small></span></div>
      </div></section>
    <div class="stat-grid">
      <section class="panel glass sbox"><h3>Top 12 de tes jeux</h3>
        ${top.map((g) => `<button class="hbar" data-act="sel" data-id="${esc(g.id)}"><img src="${esc(th(g.cover, 120))}" alt=""><span class="hn">${esc(g.name)}</span>
          <span class="ht"><span style="width:${(g.playtimeMin / max) * 100}%;background:${g.accent || '#7C9CFF'}"></span></span><b>${fmtH(g.playtimeMin)}</b></button>`).join('')}
      </section>
      <div style="display:flex;flex-direction:column;gap:20px">
        <section class="panel glass sbox"><h3>30 derniers jours</h3>
          ${last30.length > 1 ? `<div class="vbars">${last30.map(([d, m]) => `<span title="${d} · ${fmtH(m)}" style="height:${Math.max(2, (m / dmax) * 100)}%"></span>`).join('')}</div>`
            : '<span class="muted">L\'historique jour par jour se remplit à chaque ouverture de l\'appli : reviens demain.</span>'}
          ${recentTop.length ? `<h3 style="margin-top:12px">Ces 2 semaines</h3>${recentTop.map((g) => `<span class="mini"><b>${esc(g.name)}</b><span>${fmtH(g.recentMin)}</span></span>`).join('')}` : ''}
        </section>
        <section class="panel glass sbox"><h3>Par genre</h3>
          ${cats.map(([c, m]) => `<span class="cbar"><span class="cn" style="color:${catColor(c)}">${esc(lbl(c))}</span><span class="ht"><span style="width:${(m / catMax) * 100}%;background:${catColor(c)}"></span></span><b>${fmtH(m)}</b></span>`).join('')}
        </section>
        <section class="panel glass sbox"><h3>Par plateforme</h3>
          <div class="split">${bySrc.map(([k, m]) => `<span style="flex:${m};background:${{ steam: '#5B9DFF', epic: '#E6E6EA', gog: '#C97CF0' }[k]}" title="${SRC[k]}"></span>`).join('')}</div>
          ${bySrc.map(([k, m]) => `<span class="mini"><b>${SRC[k]}</b><span>${fmtH(m)} · ${Math.round((m / total) * 100)} %</span></span>`).join('')}
        </section>
      </div>
    </div>`;
}

// ---------- menus & modal ----------

function renderFree() {
  const all = freeItems();
  const todo = all.filter((x) => !x.upcoming && !x.owned).length;
  const b = $('#free-badge');
  b.hidden = !todo;
  b.textContent = todo;
  if (S.menu !== 'free') { $('#free-menu').innerHTML = ''; return; }
  const row = (x) => `<div class="free-item${x.owned ? ' owned' : ''}">
      ${x.img ? `<img src="${esc(th(x.img, 240))}" alt="">` : '<span style="width:110px;height:62px;border-radius:8px;background:#222;flex:none"></span>'}
      <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="t">${esc(x.name)}</span><span class="s">${esc(untilTxt(x) || 'Offre limitée')}</span></span>
      ${x.upcoming ? '' : x.owned ? '<span class="tagown" style="margin-left:auto">DÉJÀ À TOI</span>' : `<button class="claim" data-act="url" data-v="${esc(x.url)}">Récupérer</button>`}
    </div>`;
  const sec = (store, list, empty) => `<span class="mh">${store}</span>${list.length ? list.map(row).join('') : `<span class="muted" style="padding:6px 12px 10px">${empty}</span>`}`;
  const loading = S.free === null && S.steamFree === null && S.gogFree === null;
  $('#free-menu').innerHTML = `<div class="menu solid" style="right:0;top:54px;width:460px;max-height:75vh;overflow:auto;padding:12px">
    ${loading ? '<span class="muted" style="padding:12px">Chargement…</span>' : `
    ${sec('EPIC GAMES · CETTE SEMAINE', all.filter((x) => x.store === 'Epic' && !x.upcoming), S.free === null ? 'Chargement…' : 'Rien cette semaine.')}
    ${all.some((x) => x.store === 'Epic' && x.upcoming) ? sec('EPIC GAMES · BIENTÔT', all.filter((x) => x.store === 'Epic' && x.upcoming), '') : ''}
    <div class="sep"></div>${sec('STEAM · 100 % DE RÉDUCTION', all.filter((x) => x.store === 'Steam'), 'Aucun jeu offert en ce moment.')}
    <div class="sep"></div>${sec('GOG · GIVEAWAYS', all.filter((x) => x.store === 'GOG'), 'Aucun jeu offert en ce moment.')}`}
  </div>`;
}

function renderFriends() {
  if (S.menu !== 'friends') { $('#friends-menu').innerHTML = ''; return; }
  const f = S.friends;
  const st = (x) => (x.game ? `<span style="color:#6EE7A8">En jeu · ${esc(x.game)}</span>` : x.state ? '<span style="color:#8DB8FF">En ligne</span>' : `Hors ligne · ${esc(ago(x.lastOff))}`);
  $('#friends-menu').innerHTML = `<div class="menu solid" style="right:0;top:54px;width:360px;max-height:70vh;overflow:auto;padding:10px">
    <span class="mh">AMIS STEAM</span>
    ${f === null ? '<span class="muted" style="padding:12px">Chargement…</span>' : !f.length ? `<span class="muted" style="padding:12px">${S.acc.steamKey ? 'Aucun ami visible (liste privée ?).' : 'Ajoute ta clé Steam dans les Paramètres.'}</span>`
      : f.map((x) => {
        const g = x.appid && S.games.find((y) => y.steamAppid === x.appid);
        return `<${g ? `button class="mi fitem" data-act="sel" data-id="${esc(g.id)}"` : 'div class="mi fitem"'}><img src="${esc(x.avatar)}" alt="" loading="lazy"><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(x.name)}</b><span class="s">${st(x)}</span></span></${g ? 'button' : 'div'}>`;
      }).join('')}
  </div>`;
}

function renderModal() {
  const m = $('#modal');
  if (!S.modal) { m.innerHTML = ''; return; }
  if (S.modal.startsWith('newcol')) {
    const gid = S.modal.split('|')[1] || '';
    m.innerHTML = `<div class="overlay" data-act="close-modal"><div class="dialog solid" role="dialog" aria-modal="true" aria-label="Nouvelle collection" style="width:min(440px,100%)">
      <h2 style="margin:0">Nouvelle collection</h2>
      <label for="col-name">Nom</label><input id="col-name" type="text" maxlength="40" placeholder="Ex. : À finir en 2026" autocomplete="off">
      <div class="row2">${PALETTE.map((c, i) => `<button class="swatch" data-act="colcolor" data-v="${c}" aria-label="Couleur ${i + 1}" aria-pressed="${i === 0}" style="background:${c}"></button>`).join('')}</div>
      <div class="row2" style="justify-content:flex-end"><button class="btn2" data-act="close-modal">Annuler</button><button class="btn2 pri" data-act="createcol" data-v="${esc(gid)}">Créer</button></div>
      <span class="err" id="col-err"></span></div></div>`;
    setTimeout(() => $('#col-name')?.focus(), 50);
    return;
  }
  const a = S.acc, u = S.user;
  const tog = (k, label, desc) => `<label class="tgl"><input type="checkbox" data-pref="${k}" ${u[k] ? 'checked' : ''}><span class="sw"></span><span><b>${label}</b><span class="muted">${desc}</span></span></label>`;
  m.innerHTML = `<div class="overlay" data-act="close-modal">
    <div class="dialog solid" role="dialog" aria-modal="true" aria-label="Paramètres">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Paramètres</h2>
        <button class="ibtn glass" data-act="close-modal" aria-label="Fermer">✕</button></div>

      <div class="box"><h3>Application</h3>
        ${tog('closeToTray', 'Réduire dans la zone de notification', 'Fermer la fenêtre garde le launcher prêt à se rouvrir instantanément.')}
        ${tog('autostart', 'Lancer avec Windows', 'Démarre discrètement dans la zone de notification.')}
        ${tog('notify', 'Notifications', 'Jeux gratuits de la semaine et promos de ta liste de souhaits (vérifié toutes les 6 h).')}
        <label class="tgl"><input type="checkbox" data-lp="big" ${P.big ? 'checked' : ''}><span class="sw"></span><span><b>Mode grand écran / manette</b><span class="muted">Plein écran, éléments plus grands, navigation à la manette (A valider, B retour, Y recherche).</span></span></label>
      </div>

      <div class="box"><h3>Sauvegardes des parties</h3>
        <span class="muted">Copie les fichiers de sauvegarde de tes jeux (emplacements fournis par la base communautaire Ludusavi).</span>
        ${tog('autoBackup', 'Sauvegarder après chaque session', 'Après un jeu lancé depuis le launcher.')}
        <label for="bk-dir">Dossier</label>
        <div class="row2"><input id="bk-dir" type="text" value="${esc(u.backupDir || '')}" placeholder="Documents\\Launcher - Sauvegardes" style="flex:1"><button class="btn2" data-act="bkopen">Ouvrir</button></div>
      </div>

      <div class="box">
        <h3>Steam ${a.steamKey ? '<span class="ok">· relié</span>' : ''}</h3>
        <span class="muted">Temps de jeu exact, succès, amis, liste de souhaits. Compte : ${a.steamId ? esc(a.steamId) : 'aucun'}.</span>
        ${a.steamKey ? `<div class="row2"><span class="ok">Clé enregistrée dans le coffre Windows.</span><button class="btn2" data-act="steam-del">Retirer la clé</button></div>` : `
          <ol>
            <li>Ouvre <button class="alink" data-act="url" data-v="https://steamcommunity.com/dev/apikey" style="min-height:0">steamcommunity.com/dev/apikey</button>, domaine : <b>localhost</b>.</li>
            <li>Dans Steam : Profil › Confidentialité › « Détails de jeu » en <b>Public</b>.</li>
          </ol>
          <label for="steam-key">Clé d'API Steam</label>
          <div class="row2"><input id="steam-key" type="password" autocomplete="off" spellcheck="false" placeholder="32 caractères" style="flex:1">
            <button class="btn2 pri" data-act="steam-save">Enregistrer</button></div>`}
        <span class="err" id="steam-err"></span>
      </div>

      <div class="box">
        <h3>Epic Games ${a.epic ? `<span class="ok">· ${esc(a.epic)}</span>` : ''}</h3>
        ${a.epic ? `<div class="row2"><span class="ok">Connecté.</span><button class="btn2" data-act="epic-off">Se déconnecter</button></div>` : `
          <ol>
            <li><button class="btn2" data-act="epic-login">Ouvrir la connexion Epic</button></li>
            <li>Copie la valeur <b>authorizationCode</b> affichée, colle-la ici.</li>
          </ol>
          <div class="row2"><input id="epic-code" type="password" autocomplete="off" spellcheck="false" placeholder="authorizationCode" style="flex:1">
            <button class="btn2 pri" data-act="epic-save">Valider</button></div>`}
        <span class="err" id="epic-err"></span>
      </div>

      <div class="box">
        <h3>Fond d'écran de la bibliothèque</h3>
        <div class="fseg glass" role="radiogroup" aria-label="Type de fond" style="align-self:flex-start">
          ${[['auto', 'Automatique'], ['file', 'Image de mon PC'], ['game', "Bannière d'un jeu"]].map(([k, x]) => `<button role="radio" data-act="wp-mode" data-v="${k}" aria-pressed="${P.wp === k}" aria-checked="${P.wp === k}">${x}</button>`).join('')}
        </div>
        ${P.wp === 'file' ? `<div class="row2"><label class="btn2" for="wp-file" style="display:flex;align-items:center;cursor:pointer">Choisir une image…</label>
          <input id="wp-file" type="file" accept="image/*" class="sr"><span class="muted">${wpPath ? 'Image enregistrée' : 'Aucune image'}</span>
          ${wpPath ? '<button class="btn2" data-act="wp-clear">Retirer</button>' : ''}</div>` : ''}
        ${P.wp === 'game' ? `<label for="wp-game">Jeu</label><select id="wp-game" class="sel">
          <option value="">Choisis un jeu…</option>
          ${S.games.filter((x) => x.hero).sort((x, y) => x.name.localeCompare(y.name, 'fr')).map((x) => `<option value="${esc(x.id)}" ${x.id === P.wpGame ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>` : ''}
        ${P.wp !== 'auto' ? `<label for="wp-blur">Flou : <span id="wp-blur-v">${P.wpBlur}</span> px</label><input id="wp-blur" class="range" type="range" min="0" max="40" value="${P.wpBlur}">
          <label for="wp-dim">Assombrir : <span id="wp-dim-v">${P.wpDim}</span> %</label><input id="wp-dim" class="range" type="range" min="0" max="85" value="${P.wpDim}">` : '<span class="muted">Suit ton dernier jeu et la couleur de la collection.</span>'}
        <span class="err" id="wp-err"></span>
      </div>
      <span class="muted" style="font-size:12px">Clés et jetons : Gestionnaire d'identification de Windows. Images : redimensionnées et mises en cache sur le disque.</span>
    </div></div>`;
}

// ---------- navigation ----------

function render() {
  document.body.classList.toggle('home', S.view === 'home');
  document.body.classList.toggle('big', !!P.big);
  for (const v of ['home', 'game', 'stats']) $('#' + v).hidden = S.view !== v;
  if (S.view !== 'home') $('#home').innerHTML = '';
  if (S.view !== 'game') $('#game').innerHTML = '';
  if (S.view !== 'stats') $('#stats').innerHTML = '';
  renderTop();
  if (S.view === 'home') renderHome(); else if (S.view === 'game') renderGame(); else renderStats();
  renderFree(); renderFriends(); renderModal();
}
function select(id) {
  if (S.view === 'home') S.homeY = window.scrollY;
  S.sel = id; S.view = 'game'; S.openNews = 0; S.menu = null; S.sub = null; S.achF = 'all'; S.tab = 'ach';
  render();
  window.scrollTo({ top: 0 });
  const g = cur();
  ensureNews(g); ensureAch(g); if (g?.source === 'steam') ensureShots(g);
}
function goHome() {
  const back = S.view === 'game';
  S.view = 'home'; S.menu = null; S.sub = null;
  render();
  window.scrollTo({ top: back ? S.homeY : 0 });
  paintGrid(true);
}

async function refresh(force = false) {
  S.busy = true; $('#refresh-btn').classList.add('spin'); if (S.view === 'home') renderHome();
  try { await invoke('refresh', { force }); } catch (e) { toast('Erreur : ' + e); }
  S.busy = false; $('#refresh-btn').classList.remove('spin'); if (S.view === 'home') renderHome();
  invoke('sync_achievements').catch(() => {});
  invoke('get_history').then((h) => { S.history = h || {}; }).catch(() => {});
}

async function saveMemo() {
  const g = cur(); const ta = $('#memo-ta'); if (!g || !ta) return;
  const text = ta.value.trim();
  await invoke('set_memo', { id: g.id, text });
  if (text) S.memos[g.id] = text; else delete S.memos[g.id];
  toast(text ? `Mémo enregistré pour ${g.name}` : 'Mémo effacé');
  renderGame();
}

async function launch(g, el) {
  if (!g) return;
  el?.classList.remove('launching'); void el?.offsetWidth; el?.classList.add('launching');
  try { await invoke('launch', { id: g.id }); toast(g.installed ? `Lancement de ${g.name}…` : `Ouverture de l'installation de ${g.name}…`); } catch (err) { toast(String(err)); }
}

async function loadAccounts() { try { S.acc = await invoke('accounts_status'); } catch { /* ignore */ } }
async function loadSocial() {
  if (!S.acc.steamKey) { S.friends = []; return; }
  invoke('friends').then((f) => { S.friends = f; renderTop(); renderFriends(); }).catch(() => { S.friends = []; });
  invoke('wishlist').then((w) => { S.wishlist = w; if (S.view === 'home') renderHome(); }).catch(() => { S.wishlist = []; });
}
async function setBig(on) {
  P.big = on; savePrefs();
  try { await getCurrentWindow().setFullscreen(on); } catch { /* ignore */ }
  render();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  const inMenu = e.target.closest('.menu');
  if (!el) { if (S.menu && !inMenu) { S.menu = null; S.sub = null; render(); } return; }
  const v = el.dataset.v; const g = cur();
  switch (el.dataset.act) {
    case 'sel': S.menu = null; select(el.dataset.id); return;
    case 'play-id': e.stopPropagation(); launch(S.games.find((x) => x.id === el.dataset.id), el); return;
    case 'play': launch(g, el); return;
    case 'home': goHome(); return;
    case 'stats': S.menu = null; S.view = S.view === 'stats' ? 'home' : 'stats';
      invoke('get_history').then((h) => { S.history = h || {}; if (S.view === 'stats') renderStats(); }).catch(() => {});
      render(); window.scrollTo({ top: 0 }); return;
    case 'folder': if (g) invoke('open_folder', { id: g.id }).catch((err) => toast(String(err))); break;
    case 'openfile': invoke('open_path', { path: v }).catch((err) => toast(String(err))); return;
    case 'url': invoke('open_url', { url: v }).catch((err) => toast(String(err))); break;
    case 'menu': S.menu = S.menu === el.dataset.menu ? null : el.dataset.menu; S.sub = null;
      if (S.menu === 'free' && S.free === null) invoke('free_games').then((f) => { S.free = f; renderFree(); }).catch(() => { S.free = []; renderFree(); });
      if (S.menu === 'friends') { S.friends = S.friends ?? null; loadSocial(); }
      render(); return;
    case 'sub': S.sub = S.sub === v ? null : v; renderGame(); return;
    case 'tab': S.tab = v; S.menu = null; if (v === 'shots') ensureShots(g); renderGame(); $('#panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (v === 'memo') setTimeout(() => $('#memo-ta')?.focus(), 350); return;
    case 'achf': S.achF = v; renderGame(); return;
    case 'reach': S.menu = null; ensureAch(g, true); renderGame(); return;
    case 'news': S.openNews = S.openNews === +v ? -1 : +v; renderGame(); return;
    case 'quick': { const ta = $('#memo-ta'); ta.value = (ta.value.trimEnd() ? ta.value.trimEnd() + '\n' : '') + v + ' : '; ta.focus(); $('#memo-state').textContent = 'Non enregistré'; return; }
    case 'save-memo': saveMemo(); return;
    case 'fav': {
      const f = S.user.favorites; const i = f.indexOf(g.id);
      if (i >= 0) f.splice(i, 1); else f.push(g.id);
      saveUser(); toast(i >= 0 ? 'Retiré des favoris' : 'Ajouté aux favoris'); renderGame(); return;
    }
    case 'hide': {
      const h = S.user.hidden; const i = h.indexOf(g.id);
      if (i >= 0) h.splice(i, 1); else h.push(g.id);
      saveUser(); S.menu = null; toast(i >= 0 ? `${g.name} est de nouveau visible` : `${g.name} masqué (collection « Masqués »)`); renderGame(); return;
    }
    case 'togcol': {
      const c = S.user.collections.find((x) => x.name === v); if (!c) return;
      const i = c.ids.indexOf(g.id); if (i >= 0) c.ids.splice(i, 1); else c.ids.push(g.id);
      saveUser(); renderGame(); return;
    }
    case 'newcol': S.modal = 'newcol|' + (v || ''); S.menu = null; S.newColor = PALETTE[0]; renderModal(); return;
    case 'colcolor': S.newColor = v; document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.v === v))); return;
    case 'createcol': {
      const name = $('#col-name').value.trim();
      if (!name) { $('#col-err').textContent = 'Donne un nom à la collection.'; return; }
      if (S.user.collections.some((x) => x.name.toLowerCase() === name.toLowerCase())) { $('#col-err').textContent = 'Cette collection existe déjà.'; return; }
      S.user.collections.push({ name, color: S.newColor || PALETTE[0], ids: v ? [v] : [] });
      saveUser(); S.modal = null; toast(`Collection « ${name} » créée`); render(); return;
    }
    case 'delcol': S.user.collections = S.user.collections.filter((x) => 'c:' + x.name !== v); S.col = 'Tout'; saveUser(); renderHome(); return;
    case 'backup': S.menu = null; renderGame(); toast('Sauvegarde en cours…');
      invoke('backup_save', { id: g.id }).then((m) => toast(m)).catch((err) => toast(String(err))); return;
    case 'bkopen': invoke('open_backups').catch((err) => toast(String(err))); return;
    case 'src': S.src = v; S.col = 'Tout'; if (S.view !== 'home') goHome(); else render(); return;
    case 'col': S.col = v; renderHome(); $('#lib')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    case 'gocol': S.col = v; S.view = 'home'; render(); $('#lib')?.scrollIntoView({ behavior: 'smooth' }); return;
    case 'sort': S.sort = v; S.menu = null; renderHome(); return;
    case 'soft': S.showSoft = !S.showSoft; renderHome(); return;
    case 'refresh': refresh(); return;
    case 'rescan': S.menu = null; refresh(true); toast('Mise à jour des infos…'); return;
    case 'settings': S.modal = 'settings'; S.menu = null; await loadAccounts(); renderModal(); return;
    case 'close-modal': if (e.target === el || el.tagName === 'BUTTON') { if (S.modal === 'settings') commitSettingsText(); S.modal = null; renderModal(); } return;
    case 'steam-save': {
      const key = $('#steam-key').value.trim(); $('#steam-err').textContent = 'Vérification…';
      try { await invoke('set_steam_key', { key }); await loadAccounts(); renderModal(); toast('Steam relié'); S.ach = {}; refresh(); loadSocial(); }
      catch (err) { $('#steam-err').textContent = String(err); }
      return;
    }
    case 'steam-del': await invoke('set_steam_key', { key: '' }); await loadAccounts(); renderModal(); return;
    case 'epic-login': invoke('epic_login').catch((err) => toast(String(err))); return;
    case 'epic-save': {
      const code = $('#epic-code').value; $('#epic-err').textContent = 'Connexion…';
      try { const name = await invoke('epic_connect', { code }); await loadAccounts(); renderModal(); toast(`Epic relié : ${name || 'compte connecté'}`); S.ach = {}; refresh(); }
      catch (err) { $('#epic-err').textContent = String(err); }
      return;
    }
    case 'epic-off': await invoke('epic_disconnect'); await loadAccounts(); renderModal(); return;
    case 'wp-mode': P.wp = v; savePrefs(); renderModal(); if (S.view === 'home') renderHome(); return;
    case 'wp-clear': await invoke('set_wallpaper', { dataUrl: '' }); wpPath = null; renderModal(); if (S.view === 'home') renderHome(); return;
  }
  if (S.menu) { S.menu = null; S.sub = null; render(); }
});

function commitSettingsText() {
  const d = $('#bk-dir');
  if (d && (d.value.trim() || null) !== (S.user.backupDir || null)) { S.user.backupDir = d.value.trim() || null; saveUser(); }
}

let qTimer;
$('#q').addEventListener('input', (e) => {
  S.q = e.target.value;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { if (S.view !== 'home') { S.view = 'home'; render(); } else renderHome(); }, 80);
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Escape') back();
  if (e.key === 'Enter' && S.modal?.startsWith('newcol') && document.activeElement?.id === 'col-name') $('[data-act="createcol"]').click();
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'memo-ta') saveMemo();
});
function back() {
  if (S.modal) { if (S.modal === 'settings') commitSettingsText(); S.modal = null; renderModal(); }
  else if (S.menu) { S.menu = null; S.sub = null; render(); }
  else if (S.view !== 'home') goHome();
}
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'memo-ta') $('#memo-state').textContent = 'Non enregistré · Ctrl+Entrée pour enregistrer';
  if (id === 'wp-blur' || id === 'wp-dim') {
    P[id === 'wp-blur' ? 'wpBlur' : 'wpDim'] = +e.target.value; savePrefs();
    $(`#${id}-v`).textContent = e.target.value;
    if (S.view === 'home') renderHome();
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.pref) { S.user[t.dataset.pref] = t.checked; saveUser(); }
  if (t.dataset.lp === 'big') setBig(t.checked);
  if (t.id === 'wp-game') { P.wpGame = t.value; savePrefs(); if (S.view === 'home') renderHome(); }
  if (t.id === 'wp-file' && t.files[0]) {
    const f = t.files[0];
    const url = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });
    try { await invoke('set_wallpaper', { dataUrl: url }); wpPath = await invoke('get_wallpaper'); renderModal(); if (S.view === 'home') renderHome(); toast("Fond d'écran enregistré"); }
    catch (err) { $('#wp-err').textContent = String(err); }
  }
});

// ---------- gamepad: spatial navigation ----------

const PAD = { prev: {}, t: 0 };
function focusables() {
  return [...document.querySelectorAll('[data-act], input, select, textarea, a[href]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest('[hidden]') && (!S.modal || el.closest('#modal'));
  });
}
function move(dx, dy) {
  const all = focusables();
  const curEl = document.activeElement && all.includes(document.activeElement) ? document.activeElement : null;
  if (!curEl) { all[0]?.focus(); all[0]?.scrollIntoView({ block: 'center' }); return; }
  const c = curEl.getBoundingClientRect(); const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
  let best = null, bs = Infinity;
  for (const el of all) {
    if (el === curEl) continue;
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
    const along = dx ? x * dx : y * dy; if (along <= 4) continue;
    const across = dx ? Math.abs(y) : Math.abs(x);
    const score = along + across * 2.5;
    if (score < bs) { bs = score; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
}
function pollPad() {
  const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (pad) {
    const b = (i) => !!pad.buttons[i]?.pressed;
    const now = performance.now();
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const dir = b(14) || ax < -0.6 ? [-1, 0] : b(15) || ax > 0.6 ? [1, 0] : b(12) || ay < -0.6 ? [0, -1] : b(13) || ay > 0.6 ? [0, 1] : null;
    if (dir && now - PAD.t > 160) { move(...dir); PAD.t = now; }
    if (!dir) PAD.t = 0;
    const edge = (i) => b(i) && !PAD.prev[i];
    if (edge(0)) document.activeElement?.click();
    if (edge(1)) back();
    if (edge(3)) { $('#q').focus(); }
    if (edge(9)) setBig(!P.big);
    PAD.prev = Object.fromEntries(pad.buttons.map((x, i) => [i, x.pressed]));
  }
  requestAnimationFrame(pollPad);
}
addEventListener('gamepadconnected', () => { toast('Manette détectée : A valider, B retour, Y recherche, Start grand écran'); });
requestAnimationFrame(pollPad);

// ---------- boot ----------

let pending = false;
function onLibrary(list) {
  S.games = list;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; renderTop(); if (S.view === 'home') renderHome(); });
}

(async () => {
  const [lib, memos, achsum, user] = await Promise.all([invoke('get_cached'), invoke('get_memos'), invoke('get_achsum'), invoke('get_user')]);
  S.memos = memos; S.achsum = achsum; S.games = lib; S.user = { ...S.user, ...user };
  try { wpPath = await invoke('get_wallpaper'); } catch { /* none */ }
  render();
  if (P.big) getCurrentWindow().setFullscreen(true).catch(() => {});
  await listen('library', (e) => onLibrary(e.payload));
  await listen('achsum', (e) => { S.achsum = e.payload; if (S.view === 'home') onLibrary(S.games); });
  await loadAccounts();
  refresh();
  loadSocial();
  invoke('free_games').then((f) => { S.free = f; renderFree(); if (S.view === 'home') renderHome(); }).catch(() => {});
  invoke('steam_free_games').then((f) => { S.steamFree = f; renderFree(); if (S.view === 'home') renderHome(); }).catch(() => { S.steamFree = []; });
  invoke('gog_free_games').then((f) => { S.gogFree = f; renderFree(); if (S.view === 'home') renderHome(); }).catch(() => { S.gogFree = []; });
})();
