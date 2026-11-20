import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LANG, LOCALE, T, dec, setLang, startI18n } from './i18n.js';
import { completion, norm, prep, query, score } from './fuzzy.js';
import { canAdmin, isAdmin as adminFor } from './admin.js';
import { SLIDER, cpuShort, recommend, sheetFor } from './tuning.js';
const PS = LANG === 'en' ? '' : ' '; // space before % in French only

const S = {
  games: [], memos: {}, news: {}, hltb: {}, version: '', update: null, edit: null, free: null, steamFree: null, gogFree: null, achsum: {}, ach: {}, shots: {}, history: {},
  acc: { steamKey: false, steamId: null, epic: null },
  user: { collections: [], favorites: [], hidden: [], closeToTray: true, autostart: false, notify: true, autoBackup: true, backupDir: null },
  friends: null, wishlist: null,
  view: 'home', sel: null, q: '', src: 'all', col: 'Tout', sort: 'recent', dir: 'desc', layout: 'grid', layoutPinned: false, achShow: 9, homeDirty: false, trophyDates: {},
  tab: 'ach', achF: 'all', openNews: 0, pal: null, menu: null, sub: null, showSoft: false, busy: false, modal: null, homeY: 0,
};
const $ = (s) => document.querySelector(s);
const P = (() => {
  const d = { wp: 'auto', wpGame: '', wpBlur: 0, wpDim: 45, big: false, accentMode: 'dyn', accentFixed: '#FF6B9A', size: 'M', glass: true, motion: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(P)); } catch { /* ignore */ } };
let wpPath = null, wpTint = null; // custom wallpaper and its dominant colours [accent, deep]
const loadWpTint = async () => { wpTint = wpPath ? await invoke('image_accent', { path: wpPath }).catch(() => null) : null; };
/** Background tint of the library: the wallpaper's own colour when one is set, else the collection's. */
const libDeep = () => { if (P.wp === 'file' && wpTint) return wpTint[1]; const g = P.wp === 'game' && S.games.find((x) => x.id === P.wpGame); return g?.deep || undefined; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SRC = { steam: 'Steam', epic: 'Epic', gog: 'GOG', pc: 'PC' };
const CAT = {
  Tout: '#FF6B9A', Favoris: '#FFD45C', Installés: '#6EE7A8', 'Mises à jour': '#FFB020', 'Avec mémo': '#FFE08A', Survie: '#3EE6A8', 'Souls-like': '#FF6B6B',
  Roguelite: '#FF9F43', Metroidvania: '#A78BFA', Horreur: '#FF5C7A', Coop: '#4CBCE6', Multijoueur: '#5B9DFF', Solo: '#F5C84C', RPG: '#F5B84C',
  Chill: '#C97CF0', Incrémental: '#7CE0F0', Puzzle: '#7BC74D', Plateformes: '#FFB86B', 'Monde ouvert': '#34D399', Construction: '#F59E0B',
  Stratégie: '#60A5FA', Simulation: '#2DD4BF', Tir: '#F87171', Course: '#FB923C', Rythme: '#E879F9', Aventure: '#FBBF24', Action: '#FB7185',
  Démo: '#94A3B8', Logiciel: '#7C9CFF', Masqués: '#8B8B96', 'Coups de cœur': '#FF8000', Notés: '#00E054',
};
const PALETTE = ['#FF6B9A', '#5B9DFF', '#3EE6A8', '#FFB020', '#C97CF0', '#FF6B6B', '#2DD4BF', '#F5C84C'];
const isCustom = (c) => c.startsWith('c:');
const catColor = (c) => (isCustom(c) ? (S.user.collections.find((x) => 'c:' + x.name === c)?.color || '#FF6B9A') : CAT[c] || '#B8C2D6');
const lbl = (c) => (c === 'Logiciel' ? 'Apps' : c === 'Démo' ? 'Démos & tests' : isCustom(c) ? c.slice(2) : c);

// ---------- images: resized on the Rust side to the displayed size ----------
const IMG = 'http://img.localhost/';
const dpr = () => window.devicePixelRatio || 1;
const TW = () => (P.size === 'L' || dpr() > 1.3 ? 440 : 300);
const bgW = () => [1280, 1600, 1920, 2560, 3840].find((w) => w >= innerWidth * dpr()) || 3840;
const th = (u, w) => (u ? `${IMG}t?w=${w}&u=${encodeURIComponent(u)}` : '');
const loc = (p, w) => (p ? `${IMG}f?w=${w}&p=${encodeURIComponent(p)}` : '');
const coverSrc = (g) => th(g.cover, TW());

const fmtH = (m) => {
  if (!m) return '—';
  const h = m / 60;
  return h < 10 ? `${dec(h)} h` : `${Math.round(h).toLocaleString(LOCALE)} h`;
};
const size = (b) => (b ? `${dec(b / 1e9)} ${T('Go', 'GB')}` : '—');
function ago(ts) {
  if (!ts) return T('Jamais', 'Never');
  const d = (Date.now() / 1000 - ts) / 86400;
  if (d < 1) return T("Aujourd'hui", 'Today');
  if (d < 2) return T('Hier', 'Yesterday');
  if (d < 7) return T(`Il y a ${Math.floor(d)} j`, `${Math.floor(d)}d ago`);
  if (d < 30) return T(`Il y a ${Math.floor(d / 7)} sem.`, `${Math.floor(d / 7)}w ago`);
  return new Date(ts * 1000).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}
const day = (ts) => new Date(ts * 1000).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
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
  tick: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  shield: I('<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>', 16),
  crown: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.8 11H4.8z"/></svg>',
};

const cur = () => S.games.find((g) => g.id === S.sel) || null;
const rating = (id) => S.user.ratings?.[id] || null;
const starTxt = (v) => (v ? `★ ${dec(v)}` : '');
function starSvg(fill, i) {
  const d = 'M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
  return `<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24"><defs><clipPath id="sh${i}"><rect x="0" y="0" width="${fill * 24}" height="24"/></clipPath></defs>
    <path d="${d}" fill="rgba(255,255,255,.14)"/><path d="${d}" fill="#00E054" clip-path="url(#sh${i})"/></svg>`;
}
const starsHtml = (v) => [1, 2, 3, 4, 5].map((i) => `<button class="star" data-act="rate" data-v="${i}" aria-label="Noter ${i} sur 5">${starSvg(v >= i ? 1 : v >= i - 0.5 ? 0.5 : 0, i)}</button>`).join('');
const heartSvg = (on) => `<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="${on ? '#FF8000' : 'none'}" stroke="${on ? '#FF8000' : 'currentColor'}" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.1C1.4 8 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.5 4.3 6.9-1.8 4.5-9.3 9.1-9.3 9.1z"/></svg>`;
const isSoft = (g) => g.tags.includes('Logiciel');
const isDemo = (g) => g.tags.includes('Démo');
const isExtra = (g) => g.tags.includes('Extra');
/** a real game: not an app, demo/playtest, DLC/soundtrack, nor hidden */
const isGame = (g) => !isSoft(g) && !isDemo(g) && !isExtra(g) && !isHidden(g);
const isHidden = (g) => S.user.hidden.includes(g.id);
const isFav = (g) => S.user.favorites.includes(g.id);
const visible = () => S.games.filter((g) => !isExtra(g) && (S.col === 'Masqués' ? isHidden(g) : !isHidden(g)) && (!isSoft(g) || S.showSoft || S.col === 'Logiciel') && (!isDemo(g) || S.col === 'Démo' || S.col === 'Masqués'));
const pct = (id) => { const s = S.achsum[id]; return s && s[1] ? Math.round((s[0] / s[1]) * 100) : null; };
// ---------- fuzzy search (names prepared once per game object, i.e. per "library" event) ----------
const FZ = new WeakMap();
const fz = (g) => { let e = FZ.get(g); if (!e) { e = prep(g.name); FZ.set(g, e); } return e; };
const NM = new Map();
const nrm = (x) => { let v = NM.get(x); if (v === undefined) { if (NM.size > 4000) NM.clear(); v = norm(x); NM.set(x, v); } return v; };
/** Relevance of a game for a prepared query: its name first, then its tags and memo. */
function rel(Q, g) {
  const s = score(Q, fz(g));
  if (s || Q.n.length < 2) return s;
  if (g.tags.some((t) => nrm(lbl(t)).includes(Q.n))) return 150;
  return S.memos[g.id] && nrm(S.memos[g.id]).includes(Q.n) ? 100 : 0;
}
const ranked = (list, q) => {
  const Q = query(q), sc = new Map();
  for (const g of list) { const v = rel(Q, g); if (v) sc.set(g, v); }
  return [...sc.keys()].sort((a, b) => sc.get(b) - sc.get(a) || b.lastPlayed - a.lastPlayed);
};

// ---------- run as admin (mirror of wants_admin in lib.rs) ----------
const isAdmin = (g) => adminFor(g, S.user.adminGames);

// ---------- Vigie (optional): game mode and dev guard ----------
const VIG = { found: false, path: null, caps: {} };
const loadVigie = () => invoke('vigie_status').then((v) => { Object.assign(VIG, v); }).catch(() => {});
const DEV = { at: 0, v: null, p: null };
/** Dev servers / Docker / WSL from `Vigie --etat-dev`, cached 20 s; prefetched before the click. */
function devFetch() {
  if (!S.user.devGuard || !VIG.caps.devState) return Promise.resolve(null);
  if (performance.now() - DEV.at < (DEV.v ? 20000 : 5000)) return Promise.resolve(DEV.v); // a failure is retried sooner
  DEV.p ??= invoke('dev_state').catch(() => null).then((v) => { DEV.v = v; DEV.at = performance.now(); DEV.p = null; return v; });
  return DEV.p;
}
// RAM missing for a game (Vigie --memoire-jeu), fetched with the dev state; shown under Play.
const MEM = {}; // id -> { at, v }
function memFetch(g) {
  if (!g?.installed || !VIG.caps.gameMemory) return;
  const m = MEM[g.id];
  if (m && (m.p || performance.now() - m.at < 20000)) return;
  MEM[g.id] = { at: 0, v: m?.v, p: invoke('game_memory', { id: g.id }).catch(() => null).then((v) => {
    MEM[g.id] = { at: performance.now(), v };
    if (S.view === 'game' && S.sel === g.id) paintMem(g);
  }) };
}
function paintMem(g) {
  const el = $('#memhint');
  if (!el) return;
  const v = MEM[g.id]?.v;
  el.innerHTML = v ? `${esc(T(`Il te manque ${mo(v.manque_mo)} pour ce jeu`, `${mo(v.manque_mo)} of RAM missing for this game`))}${VIG.caps.devKill ? ` · <button class="alink" data-act="dev-kill" style="min-height:0">${esc(T('Tout couper', 'Stop dev servers'))}</button>` : ''}` : '';
  el.hidden = !v;
}

/** Worth asking? WSL alone is often up (~1 Go) and only counts from 2 Go. */
const devWorth = (st) => (st?.items || []).some((x) => x.kind !== 'wsl' || (x.ram_mo || 0) >= 2048);
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const mo = (n) => (n >= 1000 ? `${dec(n / 1024)} ${T('Go', 'GB')}` : `${Math.round(n)} ${T('Mo', 'MB')}`);
/** Non-blocking "Tout couper / Garder" card; resolves false (keep) after 2 s without an answer. */
function devPrompt(st) {
  const box = $('#devguard');
  const items = st.items || [];
  const names = [...new Set(items.map((x) => x.label || x.kind))].slice(0, 4).join(' · ');
  return new Promise((done) => {
    const end = (kill) => { clearTimeout(t); box.innerHTML = ''; box.onclick = null; devPrompt.end = null; done(kill); };
    const t = setTimeout(() => end(false), 2000);
    devPrompt.end = end;
    box.innerHTML = `<div class="devguard solid" role="alertdialog" aria-label="${esc(T('Serveurs de dev actifs', 'Dev servers running'))}" data-notr>
      <div class="dg-t"><b>${esc(T('Serveurs de dev actifs', 'Dev servers running'))}${st.total_mo ? ` · ${esc(mo(st.total_mo))}` : ''}</b><span class="muted">${esc(names)}</span></div>
      <button class="btn2" data-dg="keep">${esc(T('Garder', 'Keep'))}</button><button class="btn2 pri" data-dg="kill">${esc(T('Tout couper', 'Stop all'))}</button>
      <div class="dg-bar"><i></i></div></div>`;
    box.onclick = (e) => { const b = e.target.closest('[data-dg]'); if (b) end(b.dataset.dg === 'kill'); };
  });
}

const saveUser = () => { S.homeDirty = true; return invoke('set_user', { u: S.user }).catch((e) => toast(String(e))); };

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.className = 'solid on';
  t.innerHTML = `<span class="dot"></span>${esc(msg)}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'solid'), ms);
}
function hexDeep(hex) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const f = (v) => Math.round(v * 0.12 + 6).toString(16).padStart(2, '0');
  return `#${f(n >> 16 & 255)}${f(n >> 8 & 255)}${f(n & 255)}`;
}
function theme(a, d) {
  if (P.accentMode === 'fixed') { a = P.accentFixed; d = hexDeep(a); }
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
  const base = S.games.filter(isGame);
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
      ${g.cover ? `<img src="${esc(coverSrc(g))}" alt="" data-err="remove">` : ''}
      <span class="badges">${g.update ? `<span class="srcb upd">${icon.upd}MAJ</span>` : ''}${g.source !== 'steam' ? `<span class="srcb">${SRC[g.source].toUpperCase()}</span>` : ''}</span>
      ${memo || isFav(g) ? `<span class="memob">${isFav(g) ? `<span style="color:#FFD45C">${icon.star(true)}</span>` : icon.pen}</span>` : ''}
      ${p !== null ? `<span class="pb"><span style="width:${p}%;background:${p === 100 ? '#6EE7A8' : g.accent || '#fff'}"></span></span>` : ''}
    </span>
    <span class="meta"><span class="nm">${esc(g.name)}</span>${rating(g.id)?.stars ? `<span class="rt">${starTxt(rating(g.id).stars)}</span>` : ''}</span>
  </button>`;
}

// ---------- virtual grid (only rows on screen exist in the DOM) ----------

const VG = { list: [], cols: 1, rowH: 300, first: -1, last: -1 };

function listRow(g) {
  const a = S.achsum[g.id];
  const p = a && a[1] ? Math.round((a[0] / a[1]) * 100) : null;
  const icons = (S.ach[g.id]?.list || []).filter((x) => x.unlocked).sort((x, y) => (y.unlockTime || 0) - (x.unlockTime || 0));
  const r = rating(g.id);
  return `<button class="lrow${g.installed ? '' : ' notinst'}" data-act="sel" data-id="${esc(g.id)}" style="--g:${g.accent || '#5B9DFF'}">
    <span class="limg" style="background:${g.deep || '#1A1A20'}">${g.hero || g.cover ? `<img src="${esc(th(g.hero || g.cover, 600))}" alt="" data-err="remove">` : ''}</span>
    <span class="linfo">
      <span class="ltitle"><b class="nm">${esc(g.name)}</b>${p === 100 ? `<span class="lcrown" title="100%">${icon.crown}</span>` : ''}${r?.stars ? `<span class="rt">${starTxt(r.stars)}</span>` : ''}${g.source !== 'steam' ? `<span class="srcb">${SRC[g.source].toUpperCase()}</span>` : ''}</span>
      <span class="lstats"><span><span class="k">TEMPS DE JEU</span> ${fmtH(g.playtimeMin)}</span><span><span class="k">DERNIÈRE SESSION</span> ${esc(ago(g.lastPlayed))}</span></span>
      ${a ? `<span class="lach"><span class="k">SUCCÈS</span><span class="ln">${a[0]}/${a[1]}</span></span>
        <span class="lbar"><span style="width:${p}%;background:${p === 100 ? '#F5C84C' : 'var(--g)'}"></span></span>` : '<span class="lach muted">—</span>'}
    </span>
    <span class="licons" data-ic="${esc(g.id)}">${icons.slice(0, 5).map((x) => `<img src="${esc(th(x.icon, 80))}" alt="" title="${esc(x.name)}" data-err="remove">`).join('')}${icons.length > 5 ? `<span class="lmore">+${icons.length - 5}</span>` : ''}</span>
  </button>`;
}
// fetch the unlocked-achievement icons of rows on screen, a few at a time
const iconQueue = []; let iconBusy = 0;
function rowIcons(g) {
  if (!S.achsum[g.id] || !S.achsum[g.id][0] || S.ach[g.id] !== undefined || iconQueue.includes(g.id)) return;
  iconQueue.push(g.id); pumpIcons();
}
function pumpIcons() {
  while (iconBusy < 3 && iconQueue.length) {
    const id = iconQueue.shift(); iconBusy++;
    S.ach[id] = null;
    invoke('achievements', { id }).then((l) => { S.ach[id] = l; }).catch(() => { S.ach[id] = { list: [] }; }).finally(() => {
      iconBusy--;
      const slot = document.querySelector(`.licons[data-ic="${CSS.escape(id)}"]`);
      const g = S.games.find((x) => x.id === id);
      if (slot && g) slot.outerHTML = listRow(g).match(/<span class="licons"[\s\S]*?<\/span>\s*<\/button>/)[0].replace(/<\/button>$/, '');
      pumpIcons();
    });
  }
}
function mountGrid(list) {
  VG.list = list;
  const host = $('#vgrid'); if (!host) return;
  if (!host.firstElementChild) { VG.first = VG.last = -1; VG.wrap = ''; VG.items = []; }
  layoutGrid(); paintGrid(true);
}
const frag = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
/** Re-renders a container of identical-looking items, replacing only the items whose HTML changed. */
function patchItems(host, wrap, items) {
  const box = host.firstElementChild;
  if (box && VG.wrap === wrap && VG.items.length === items.length && box.children.length === items.length) {
    items.forEach((h, i) => { if (VG.items[i] !== h) box.children[i].replaceWith(frag(h)); });
  } else {
    host.innerHTML = items.length ? `${wrap}${items.join('')}</div>` : '';
  }
  VG.wrap = wrap; VG.items = items;
}
/** Sets the page's top-level sections, keeping the DOM of sections that did not change. */
function setSections(host, html) {
  const next = [...frag(html).children];
  const strs = next.map((n) => n.outerHTML);
  const cur = [...host.children];
  if (host.__secs && cur.length === next.length) {
    next.forEach((n, i) => { if (host.__secs[i] !== strs[i]) cur[i].replaceWith(n); });
  } else {
    host.replaceChildren(...next);
  }
  host.__secs = strs;
}
const isList = () => S.layout === 'list';
function layoutGrid() {
  const host = $('#vgrid'); if (!host) return;
  const W = host.clientWidth || innerWidth - 112;
  if (isList()) {
    VG.cols = 1; VG.cellH = 148; VG.rowH = VG.cellH + 12;
    host.style.height = `${Math.max(0, VG.list.length * VG.rowH - 12)}px`;
    return;
  }
  const min = ({ S: 118, M: 150, L: 200 }[P.size] || 150) + (P.big ? 50 : 0); const gap = 20; const rowGap = 24;
  VG.cols = Math.max(1, Math.floor((W + gap) / (min + gap)));
  const itemW = (W - gap * (VG.cols - 1)) / VG.cols;
  VG.cellH = Math.ceil(itemW * 1.5 + 8 + 22);
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
  if (isList()) {
    patchItems(host, `<div class="lgrid" style="position:absolute;left:0;right:0;top:${first * VG.rowH}px;grid-auto-rows:${VG.cellH}px">`, items.map(listRow));
    items.forEach(rowIcons);
    return;
  }
  patchItems(host, `<div class="grid" style="position:absolute;left:0;right:0;top:${first * VG.rowH}px;grid-template-columns:repeat(${VG.cols},minmax(0,1fr));grid-auto-rows:${VG.cellH}px">`, items.map(cover));
}
addEventListener('scroll', () => paintGrid(), { passive: true });
addEventListener('resize', () => { if ($('#vgrid')) { layoutGrid(); paintGrid(true); } });

// ---------- HOME ----------

function inCol(g, c) {
  if (c === 'Tout' || c === 'Masqués') return true;
  if (c === 'Favoris') return isFav(g);
  if (c === 'Coups de cœur') return !!rating(g.id)?.heart;
  if (c === 'Notés') return !!rating(g.id)?.stars;
  if (c === 'Installés') return g.installed;
  if (c === 'Mises à jour') return g.update;
  if (c === 'Avec mémo') return !!S.memos[g.id];
  if (isCustom(c)) return !!S.user.collections.find((x) => 'c:' + x.name === c)?.ids.includes(g.id);
  return g.tags.includes(c);
}

function collections() {
  const pool = S.games.filter((g) => !isHidden(g) && !isExtra(g) && (S.src === 'all' || g.source === S.src));
  const base = pool.filter((g) => (!isSoft(g) || S.showSoft) && !isDemo(g));
  const counts = {};
  base.forEach((g) => g.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const list = ['Tout'];
  if (pool.some(isFav)) list.push('Favoris');
  if (pool.some((g) => rating(g.id)?.heart)) list.push('Coups de cœur');
  if (pool.some((g) => rating(g.id)?.stars)) list.push('Notés');
  S.user.collections.forEach((c) => list.push('c:' + c.name));
  list.push('Installés');
  if (pool.some((g) => g.update)) list.push('Mises à jour');
  if (pool.some(isSoft)) list.push('Logiciel');
  if (pool.some((g) => S.memos[g.id])) list.push('Avec mémo');
  Object.entries(counts).filter(([t, n]) => n >= 2 && t !== 'Logiciel' && t !== 'Démo').sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([t]) => list.push(t));
  if (pool.some(isDemo)) list.push('Démo');
  if (S.user.hidden.length) list.push('Masqués');
  const rank = (a, b) => b.lastPlayed - a.lastPlayed || b.playtimeMin - a.playtimeMin;
  return list.map((c) => {
    const src = c === 'Logiciel' ? pool.filter(isSoft) : c === 'Démo' ? pool.filter(isDemo) : c === 'Masqués' ? S.games.filter(isHidden) : base;
    const inside = src.filter((g) => inCol(g, c)).sort(rank);
    return { c, n: inside.length, art: inside.filter((g) => g.cover).slice(0, 3) };
  });
}

function filtered() {
  const q = S.q.trim();
  const l = visible().filter((g) => (S.src === 'all' || g.source === S.src) && inCol(g, S.col));
  if (q) return ranked(l, q); // best match first: Enter launches it
  const by = {
    recent: (a, b) => b.lastPlayed - a.lastPlayed || b.playtimeMin - a.playtimeMin || a.name.localeCompare(b.name, LOCALE),
    hours: (a, b) => b.playtimeMin - a.playtimeMin,
    az: (a, b) => a.name.localeCompare(b.name, LOCALE),
    pct: (a, b) => (pct(b.id) ?? -1) - (pct(a.id) ?? -1),
    rating: (a, b) => (rating(b.id)?.stars || 0) - (rating(a.id)?.stars || 0) || b.playtimeMin - a.playtimeMin,
    size: (a, b) => b.size - a.size,
  };
  by.achn = (a, b) => (S.achsum[b.id]?.[0] || 0) - (S.achsum[a.id]?.[0] || 0) || b.playtimeMin - a.playtimeMin;
  l.sort(by[S.sort]);
  return S.dir === 'asc' ? l.reverse() : l;
}
const arrow = () => (S.dir === 'asc' ? '↑' : '↓');
const SORTS = [['recent', 'Joués récemment'], ['hours', 'Temps de jeu'], ['achn', 'Succès obtenus'], ['rating', 'Ma note'], ['pct', 'Complétion des succès'], ['az', 'Alphabétique'], ['size', 'Taille sur disque']];

const normN = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Every free-to-keep offer, all stores, flagged when already in the library. */
function freeItems() {
  const owned = (store, name, appid) => S.games.some((g) => (appid && g.steamAppid === appid && g.source === 'steam') || (g.source === store && normN(g.name) === normN(name)));
  const epic = (S.free || []).map((x) => ({ store: 'Epic', name: x.title, img: x.image, url: x.url, until: x.until, upcoming: x.upcoming, owned: !x.upcoming && owned('epic', x.title) }));
  const steam = (S.steamFree || []).map((d) => ({ store: 'Steam', name: d.name, img: d.cover, url: `https://store.steampowered.com/app/${d.appid}`, until: '', upcoming: false, owned: owned('steam', d.name, d.appid) }));
  const gog = (S.gogFree || []).map((x) => ({ store: 'GOG', name: x.title, img: x.image, url: x.url, until: '', upcoming: false, owned: owned('gog', x.title) }));
  return [...epic, ...steam, ...gog];
}
const untilTxt = (x) => (x.until ? `${x.upcoming ? T('Dès le', 'From') : T("Jusqu'au", 'Until')} ${new Date(x.until).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })}` : '');

function dealsRow() {
  const w = (S.wishlist || []).filter((d) => d.discount > 0).slice(0, 12);
  const free = freeItems().filter((x) => !x.upcoming).sort((a, b) => a.owned - b.owned);
  if (!w.length && !free.length) return '';
  return `<section class="deals-wrap">
    <div class="cols-head"><div><h2>Bons plans</h2></div></div>
    <div class="deals">
      ${free.map((d) => `<button class="deal glass${d.owned ? ' owned' : ''}" data-act="url" data-v="${esc(d.url)}">
        <span class="dimg">${d.img ? `<img src="${esc(th(d.img, 360))}" alt="" loading="lazy">` : ''}<span class="store">${d.store}</span></span>
        <span class="dt"><b>${esc(d.name)}</b>${d.owned ? '<span class="tagown">DÉJÀ À TOI</span>' : '<span class="tagfree">GRATUIT</span>'}<span class="muted" style="font-size:12px">${esc(untilTxt(d))}</span></span></button>`).join('')}
      ${w.map((d) => `<button class="deal glass" data-act="url" data-v="https://store.steampowered.com/app/${d.appid}">
        <span class="dimg">${d.cover ? `<img src="${esc(th(d.cover, 360))}" alt="" loading="lazy">` : ''}<span class="off">-${d.discount}${PS}%</span></span>
        <span class="dt"><b>${esc(d.name)}</b><span><s class="muted">${esc(d.original)}</s> <strong>${esc(d.price)}</strong></span></span></button>`).join('')}
    </div></section>`;
}

/** Each sort gets its natural layout: list for achievements, grid otherwise (the toggle overrides it until the next sort). */
function autoLayout() { S.layout = ['achn', 'pct'].includes(S.sort) ? 'list' : 'grid'; }
function sortMenu() {
  const slot = $('#sort-menu'); if (!slot) return;
  $('[data-menu="sort"]')?.setAttribute('aria-expanded', String(S.menu === 'sort'));
  slot.innerHTML = S.menu === 'sort' ? `<div class="menu solid" role="menu" style="right:0;top:54px">
    <span class="mh">TRIER PAR</span>
    ${SORTS.map(([k, l]) => `<button class="mi" role="menuitemradio" aria-checked="${S.sort === k}" data-act="sort" data-v="${k}"><span class="rd"></span>${l}</button>`).join('')}
    <div class="sep"></div><span class="mh">ORDRE</span>
    ${[['desc', 'Décroissant'], ['asc', 'Croissant']].map(([k, l]) => `<button class="mi" role="menuitemradio" aria-checked="${S.dir === k}" data-act="sortdir" data-v="${k}"><span class="rd"></span>${l}</button>`).join('')}
    <div class="sep"></div>
    <button class="mi" role="menuitemcheckbox" aria-checked="${S.showSoft}" data-act="soft"><span class="cb">${S.showSoft ? icon.tick : ''}</span>Inclure les apps<span class="r">${S.games.filter(isSoft).length}</span></button>
  </div>` : '';
}
function optsSlot() {
  const slot = $('#opts-menu'); const g = cur(); if (!slot || !g) return;
  $('[data-menu="opts"]')?.setAttribute('aria-expanded', String(S.menu === 'opts'));
  slot.innerHTML = S.menu === 'opts' ? optsMenu(g) : '';
}
/** Menus only: never re-render the page behind them (no layout jump). */
function renderMenus() { sortMenu(); optsSlot(); renderFree(); renderFriends(); }

/** Re-render a view in place, keeping the page height and scroll position. */
function keepScroll(host, paint) {
  const y = window.scrollY;
  host.style.minHeight = `${host.offsetHeight}px`;
  paint();
  host.style.minHeight = '';
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
}

function renderHome() { S.homeDirty = false; keepScroll($('#home'), paintHome); }
function homeTheme() {
  const all = S.games.filter(isGame);
  const last = [...all].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  theme(catColor(S.col), libDeep());
  const wpG = P.wp === 'game' && S.games.find((x) => x.id === P.wpGame);
  if (P.wp === 'file' && wpPath) setBg(loc(wpPath, P.wpBlur > 8 ? 1280 : bgW()), false, true);
  else if (wpG) setBg(th(wpG.hero || wpG.cover, P.wpBlur > 8 ? 1280 : bgW()), false, true);
  else setBg(bgSrc(last, true), true);
}
function paintHome() {
  const all = S.games.filter(isGame);
  const total = all.reduce((s, g) => s + g.playtimeMin, 0);
  const bySrc = Object.keys(SRC).map((k) => [k, all.filter((g) => g.source === k).reduce((s, g) => s + g.playtimeMin, 0)]).filter(([, v]) => v > 0);
  const sums = Object.entries(S.achsum).filter(([id]) => all.some((g) => g.id === id)).map(([, v]) => v);
  const un = sums.reduce((s, v) => s + v[0], 0), tot = sums.reduce((s, v) => s + v[1], 0);
  const perfect = sums.filter((v) => v[1] && v[0] === v[1]).length;
  const updates = all.filter((g) => g.update).length;
  const last = [...all].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  const col = S.col;
  theme(catColor(col), libDeep());
  const wpG = P.wp === 'game' && S.games.find((x) => x.id === P.wpGame);
  if (P.wp === 'file' && wpPath) setBg(loc(wpPath, P.wpBlur > 8 ? 1280 : bgW()), false, true);
  else if (wpG) setBg(th(wpG.hero || wpG.cover, P.wpBlur > 8 ? 1280 : bgW()), false, true);
  else setBg(bgSrc(last, true), true);
  const cols = collections();
  const list = filtered();
  const lastMemo = last && S.memos[last.id];

  setSections($('#home'), `
    <section class="home-head">
      <div>
        <h1>Bibliothèque</h1>
        <div class="sub">${all.length} ${T('jeux', 'games')} · ${all.filter((g) => g.installed).length} ${T('installés', 'installed')}${updates ? ` · <button class="alink" data-act="col" data-v="Mises à jour" style="min-height:0;display:inline">${updates} ${T('MAJ', updates > 1 ? 'updates' : 'update')}</button>` : ''}${S.busy ? ' · …' : ''}</div>
      </div>
      <div class="kpis glass">
        <button class="kpi" data-act="kpi" data-v="hours" aria-pressed="${S.sort === 'hours'}"><span class="k">TEMPS DE JEU<span>${S.sort === 'hours' ? arrow() : ''}</span></span><span class="v">${fmtH(total)}</span>
          <span class="muted" style="font-size:12px">${bySrc.map(([k, v]) => `${SRC[k]} ${fmtH(v)}`).join(' · ') || '—'}</span></button>
        ${tot ? `<button class="kpi" data-act="kpi" data-v="achn" aria-pressed="${S.sort === 'achn'}"><span class="k">SUCCÈS<span>${S.sort === 'achn' ? arrow() : ''}</span></span><span class="v">${un.toLocaleString(LOCALE)}<small>/ ${tot.toLocaleString(LOCALE)}</small></span>
          <span class="bar"><span style="width:${Math.round((un / tot) * 100)}%"></span></span></button>`
          : `<div><span class="k">SUCCÈS</span><span class="v">—</span><button class="alink" data-act="settings" style="min-height:0">Relier →</button></div>`}
        <button class="kpi gold" data-act="trophy" ${tot ? '' : 'disabled'}><span class="k">${icon.crown} 100 %</span><span class="v">${tot ? perfect : '—'}</span></button>
      </div>
    </section>

    ${last ? `<button class="resume" data-act="sel" data-id="${esc(last.id)}" style="--a:${last.accent || 'var(--a)'}">
      ${last.hero || last.cover ? `<img class="h" src="${esc(th(last.hero || last.cover, Math.min(bgW(), 2560)))}" alt="">` : ''}
      <span class="fade"></span>
      <span class="in">
        ${last.logo ? `<img class="lg" src="${esc(th(last.logo, 640))}" alt="${esc(last.name)}" data-err="nm" data-name="${esc(last.name)}">` : `<span class="nm">${esc(last.name)}</span>`}
        <span class="meta">
          <span class="k"><span class="dot" style="background:${last.accent};box-shadow:0 0 12px ${last.accent}"></span>${esc(ago(last.lastPlayed).toUpperCase())}</span>
          <span>${fmtH(last.playtimeMin)} ${pct(last.id) !== null ? ` · ${pct(last.id)}${PS}%` : ''}</span>
          ${lastMemo ? `<span class="memo">✎ ${esc(lastMemo)}</span>` : ''}
        </span>
        <span class="play sm go" data-act="play-id" data-id="${esc(last.id)}" style="background:${last.accent}">${last.installed ? icon.play + 'Jouer' : icon.dl + 'Installer'}</span>
      </span>
    </button>` : ''}

    <section class="cols-wrap">
      <div class="cols-head"><div><h2>Collections</h2></div>
        <button class="glass pillbtn" data-act="newcol">+ Collection</button></div>
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
        <div><h2>${col === 'Tout' ? 'Tous les jeux' : esc(lbl(col))}</h2><span class="muted">${list.length}${S.q ? ` · « ${esc(S.q)} »` : ''}</span></div>
        <div class="row2">
          ${isCustom(col) ? `<button class="btn2" data-act="delcol" data-v="${esc(col)}">Supprimer la collection</button>` : ''}
          <button class="glass pillbtn" data-act="addgame" title=".exe, .lnk">+ Jeu</button>
          <div class="glass seg vt" role="group" aria-label="Affichage">
            <button data-act="layout" data-v="grid" aria-pressed="${!isList()}" aria-label="Grille">${I('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>', 16)}</button>
            <button data-act="layout" data-v="list" aria-pressed="${isList()}" aria-label="Liste">${I('<path d="M4 6h16M4 12h16M4 18h16"/>', 16)}</button>
          </div>
          <div class="anchor">
            <button class="glass pillbtn" data-act="menu" data-menu="sort" aria-expanded="${S.menu === 'sort'}">
              ${I('<path d="M4 6h16M7 12h10M10 18h4"/>', 16)} Trier : <strong>${SORTS.find((s) => s[0] === S.sort)[1]}</strong> ${arrow()}</button>
            <div id="sort-menu"></div>
          </div>
        </div>
      </div>
      ${list.length ? '<div id="vgrid" class="vgrid"></div>' : `<div class="grid"><div class="empty">${S.games.length ? 'Aucun jeu ne correspond.' : S.busy ? 'Analyse…' : 'Aucun jeu détecté.'}</div></div>`}
    </section>`);
  layoutGrid();
  sortMenu();
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
  return `<div class="menu solid" role="menu" style="left:0;top:72px;min-width:240px">
    <span class="mh">${esc(g.name.toUpperCase())}</span>
    <button class="mi" data-act="fav">${icon.star(isFav(g))}${isFav(g) ? 'Retirer des favoris' : 'Favori'}</button>
    <div class="subwrap">
      <button class="mi" data-act="sub" data-v="cols">Collections<span class="r">${icon.right}</span></button>
      ${S.sub === 'cols' ? `<div class="menu solid submenu" role="menu">
        <span class="mh">COLLECTIONS</span>
        ${inCols.map((c) => `<button class="mi" role="menuitemcheckbox" aria-checked="${c.ids.includes(g.id)}" data-act="togcol" data-v="${esc(c.name)}"><span class="cdot" style="background:${c.color}"></span>${esc(c.name)}${c.ids.includes(g.id) ? icon.check : ''}</button>`).join('') || '<span class="muted" style="padding:8px 12px">—</span>'}
        <div class="sep"></div><button class="mi" data-act="newcol" data-v="${esc(g.id)}">+ Nouvelle</button>
      </div>` : ''}
    </div>
    <button class="mi" data-act="tab" data-v="memo">Mémo</button>
    <button class="mi" data-act="tab" data-v="review">Noter</button>
    ${g.source === 'pc' ? '<button class="mi" data-act="editgame">Modifier…</button>' : ''}
    ${canAdmin(g) ? `<button class="mi" role="menuitemcheckbox" aria-checked="${isAdmin(g)}" data-act="admin">${icon.shield}Lancer en admin${isAdmin(g) ? icon.check : ''}</button>` : ''}
    <div class="sep"></div>
    ${g.installed ? `<button class="mi" data-act="backup">Sauvegarder</button>` : ''}
    ${g.installed && g.installPath ? '<button class="mi" data-act="folder">Dossier</button>' : ''}
    <div class="subwrap">
      <button class="mi" data-act="sub" data-v="manage">Gérer<span class="r">${icon.right}</span></button>
      ${S.sub === 'manage' ? `<div class="menu solid submenu" role="menu">
        ${st && !g.installed ? `<button class="mi" data-act="url" data-v="steam://install/${g.steamAppid}">Installer</button>` : ''}
        ${st && g.update ? `<button class="mi" data-act="url" data-v="steam://nav/downloads">Mettre à jour</button>` : ''}
        ${st && g.installed ? `<button class="mi" data-act="url" data-v="steam://validate/${g.steamAppid}">Vérifier les fichiers</button>` : ''}
        ${st && g.installed ? `<button class="mi danger" data-act="url" data-v="steam://uninstall/${g.steamAppid}">Désinstaller…</button>` : ''}
        ${g.source === 'epic' ? `<button class="mi" data-act="url" data-v="com.epicgames.launcher://store/library">Ouvrir Epic</button>` : ''}
        ${st ? `<button class="mi" data-act="url" data-v="steam://nav/games/details/${g.steamAppid}">Voir dans Steam</button>` : ''}
        ${g.steamAppid ? `<button class="mi" data-act="url" data-v="https://store.steampowered.com/app/${g.steamAppid}">Page Steam</button>` : ''}
        <div class="sep"></div>
        <button class="mi" data-act="hide">${isHidden(g) ? 'Afficher' : 'Masquer'}</button>
        ${g.source === 'pc' ? '<button class="mi danger" data-act="removegame">Retirer de la bibliothèque</button>' : ''}<button hidden></button>
      </div>` : ''}
    </div>
    <button class="mi" data-act="reach">Recharger</button>
  </div>`;
}

function achPanel(g) {
  const a = S.ach[g.id];
  if (a === undefined || a === null) return '<div class="empty">…</div>';
  const note = a.note ? `<div class="note">${esc(a.note)}${/Paramètres|clé|Connecte/.test(a.note) ? ' <button class="btn2 pri" data-act="settings">Paramètres</button>' : ''}</div>` : '';
  if (!a.total) return `<div style="padding-top:20px">${note || '<div class="empty">Aucun succès.</div>'}</div>`;
  const p = Math.round((a.unlocked / a.total) * 100);
  let l = a.list;
  if (S.achF === 'got') l = l.filter((x) => x.unlocked);
  if (S.achF === 'todo') l = l.filter((x) => !x.unlocked);
  if (S.achF === 'rare') l = [...l].filter((x) => x.rarity != null).sort((x, y) => x.rarity - y.rarity).slice(0, 20);
  if (S.achF === 'all') l = [...l].sort((x, y) => (y.unlocked - x.unlocked) || (y.unlockTime - x.unlockTime));
  const F = [['all', 'Tous'], ['got', 'Obtenus'], ['todo', 'À faire'], ['rare', 'Rares']];
  return `<div class="ach-top">
      <div style="flex:1 1 360px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:baseline;gap:12px"><span class="big">${p}${PS}%</span><span class="muted" style="font-size:15px">${a.unlocked} / ${a.total}</span></div>
        <div class="bigbar"><span style="width:${p}%"></span></div>
      </div>
      <div class="fseg glass" role="group" aria-label="Filtrer">${F.map(([k, x]) => `<button data-act="achf" data-v="${k}" aria-pressed="${S.achF === k}">${x}</button>`).join('')}</div>
    </div>${note}
    <div class="achs">${l.slice(0, S.achShow).map((x) => `<div class="ach${x.unlocked ? ' on' : ''}">
        ${x.icon ? `<img src="${esc(th(x.icon, 104))}" alt="" loading="lazy" data-err="hide">` : '<span style="width:52px;height:52px;border-radius:12px;background:#222;flex:none"></span>'}
        <span class="t"><b>${esc(x.name)}</b><span>${esc(x.desc)}</span></span>
        <span class="r">${x.rarity != null ? (x.rarity < 10 ? `<span class="rare">${dec(x.rarity)}${PS}%</span>` : `${Math.round(x.rarity)}${PS}%`) : ''}<span>${x.unlocked ? (x.unlockTime ? day(x.unlockTime) : 'Débloqué') : 'Verrouillé'}</span></span>
      </div>`).join('') || '<div class="empty">Rien dans ce filtre.</div>'}</div>
    ${l.length > S.achShow ? `<div class="more-row"><button class="btn2" data-act="achmore">Afficher plus</button><span class="muted">${S.achShow} / ${l.length}</span></div>` : ''}`;
}

function newsPanel(g) {
  const list = g.steamAppid ? S.news[g.steamAppid] : null;
  if (!g.steamAppid) return `<div class="empty">Aucune actu.</div>`;
  if (!list || !list.length) return `<div class="empty">${list ? 'Aucune actu.' : '…'}</div>`;
  return list.map((n, i) => `<div class="nrow">
      <button class="acc" data-act="news" data-v="${i}" aria-expanded="${S.openNews === i}">
        <span class="b ${i === 0 ? 'first' : ''}">${esc(ago(n.date))}</span>
        <span class="t"><span>${esc(n.title)}</span><span class="muted" style="font-size:13px">${esc(day(n.date))}</span></span>
        ${icon.chev}
      </button>
      ${S.openNews === i ? `<div class="nbody"><span>${esc(n.body || '—')}</span><button class="alink" data-act="url" data-v="${esc(n.url)}">Lire en entier ↗</button></div>` : ''}
    </div>`).join('');
}

function shotsPanel(g) {
  const l = S.shots[g.id];
  if (!l) return '<div class="empty">…</div>';
  if (!l.length) return `<div class="empty">${g.source === 'steam' ? 'Aucune capture (F12 en jeu).' : 'Steam uniquement.'}</div>`;
  const w = dpr() > 1.3 ? 720 : 480;
  return `<div class="shots">${l.map((p) => `<button class="shot" data-act="openfile" data-v="${esc(p)}" ><img src="${esc(loc(p, w))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`;
}

function hltbCard(g) {
  if (isSoft(g)) return '';
  const h = S.hltb[g.id];
  if (h === undefined) return '';
  if (h === null) return '';
  if (h.err) return '';
  const pt = g.playtimeMin / 60;
  const ref = h.main || h.plus || h.full;
  const pc = ref ? Math.min(100, Math.round((pt / ref) * 100)) : 0;
  const f = (x) => (x ? `${x < 10 ? dec(x) : Math.round(x)} h` : '—');
  return `<div class="card glass"><span class="k">POUR FINIR</span>
    <div class="hl"><span><b>${f(h.main)}</b><small>Histoire</small></span><span><b>${f(h.plus)}</b><small>+ Extras</small></span><span><b>${f(h.full)}</b><small>100 %</small></span></div>
    ${ref && pt ? `<span class="minibar wide"><span style="width:${pc}%"></span></span><span class="muted" style="font-size:12px">${fmtH(g.playtimeMin)} · ${pc}${PS}%</span>` : ''}
    <button class="alink" data-act="url" data-v="${esc(h.url)}" style="min-height:0">HowLongToBeat ↗</button></div>`;
}
async function ensureHltb(g) {
  if (!g || S.hltb[g.id] !== undefined || isSoft(g)) return;
  S.hltb[g.id] = undefined;
  try { S.hltb[g.id] = await invoke('hltb', { id: g.id }); } catch (e) { S.hltb[g.id] = { err: String(e) }; }
  if (S.view === 'game' && S.sel === g.id) renderGame();
}

function reviewPanel(g) {
  const r = rating(g.id) || {};
  return `<div class="memo-tab">
    <div class="rate big-rate" role="group" aria-label="Ma note"><span class="stars">${starsHtml(r.stars || 0)}</span>
      <button class="heart" data-act="heart" aria-pressed="${!!r.heart}" aria-label="Coup de cœur">${heartSvg(!!r.heart)}</button>
      ${r.stars ? `<span class="rv">${dec(r.stars)}</span>` : ''}</div>
    <label for="review-ta" class="sr">Avis</label>
    <textarea id="review-ta" rows="6" placeholder="Écris quelque chose…">${esc(r.review || '')}</textarea>
    <div class="btns"><button class="save" data-act="save-review">Enregistrer</button></div>
  </div>`;
}

// ---------- recommended settings for this PC (U6) ----------

let HW = null; // detected PC (cached on the Rust side)
const TUNE_CUR = {}; // game id -> { values, backup } read from its config file, null if unreadable
const TUNE_LAST = {}; // game id -> last recommendation shown (what « Appliquer » writes)
const tunePrefs = (g) => ({ slider: 2, target: Math.min(HW?.hz || 60, 120), ...(S.user.tuning?.[g.id] || {}) });
function ensureTune(g) {
  if (!HW) invoke('hw_info').then((h) => { HW = h; if (S.view === 'game' && S.tab === 'tune') renderGame(); }).catch(() => {});
  const sh = sheetFor(g);
  if (sh && !(g.id in TUNE_CUR)) {
    TUNE_CUR[g.id] = null;
    invoke('game_settings', { format: sh.config.format }).then((c) => { TUNE_CUR[g.id] = c; if (S.view === 'game' && S.tab === 'tune') renderGame(); }).catch(() => {});
  }
}
const tv = (v) => (v === true ? T('Activé', 'On') : v === false ? T('Désactivé', 'Off') : v === undefined || v === null || v === '' ? '—' : String(v).replace(/^UI-Settings-Video-QualitySetting-/, ''));
function tunePanel(g) {
  if (!HW) return `<div class="tn empty">${T('Détection du PC…', 'Detecting your PC…')}</div>`;
  const sh = sheetFor(g);
  const pr = tunePrefs(g);
  const cur = TUNE_CUR[g.id]?.values || {};
  const r = recommend({ hw: HW, sheet: sh, current: cur, slider: pr.slider, target: pr.target, lang: LANG });
  const gpu = r.gpu;
  const pcLine = [gpu.name.replace(/^NVIDIA GeForce |^AMD Radeon /, ''), `${Math.round(gpu.vram)} ${T('Go', 'GB')}`, cpuShort(HW.cpu), `${Math.round(HW.ramMb / 1024)} ${T('Go', 'GB')}`, `${HW.width} × ${HW.height} · ${HW.hz} Hz`, gpu.dlss ? 'DLSS' : ''].filter(Boolean);
  const fpsOpts = [...new Set([60, 90, 120, 144, 165, 240, HW.hz].filter((x) => x <= HW.hz))].sort((a, b) => a - b);
  const verdict = r.verdict === 'out' ? T(`${r.goal} images/s hors de portée dans ce jeu : réglages au plus léger`, `${r.goal} FPS is out of reach in this game: lightest settings`)
    : r.verdict === 'tight' ? T(`${r.goal} images/s : atteignable, sans grande marge`, `${r.goal} FPS: reachable, with little headroom`)
      : T(`${r.goal} images/s : atteignable avec de la marge`, `${r.goal} FPS: reachable with headroom`);
  const cpuNote = r.cpuLimited ? `<span class="tn-cpu">${esc(T(`Au-delà d'environ ${Math.round(r.goal * 0.8 / 10) * 10} images/s en ville, le processeur limite : les graphismes n'y peuvent plus grand-chose.`, `Beyond about ${Math.round(r.goal * 0.8 / 10) * 10} FPS in the city, the CPU is the limit: graphics settings won't help much more.`))}</span>` : '';
  const head = `<div class="tn-head" data-notr>
      <div class="tn-pc"><span class="k">${esc(T('TON PC', 'YOUR PC'))}</span><span>${pcLine.map(esc).join(' · ')}</span></div>
      <div class="tn-ctl">
        <label class="tn-sl"><span class="k">${esc(T('PERFORMANCE', 'PERFORMANCE'))}</span>
          <input id="tune-s" type="range" min="0" max="4" step="1" value="${pr.slider}" aria-label="${esc(T('Performance ou qualité', 'Performance or quality'))}" aria-valuetext="${esc(SLIDER[pr.slider][LANG] || SLIDER[pr.slider].fr)}">
          <span class="k">${esc(T('QUALITÉ', 'QUALITY'))}</span></label>
        <span class="tn-pos">${esc(SLIDER[pr.slider][LANG] || SLIDER[pr.slider].fr)}</span>
        <div class="fseg glass" role="radiogroup" aria-label="${esc(T('Cible d\'images/s', 'FPS target'))}">${fpsOpts.map((f) => `<button role="radio" data-act="tune-fps" data-v="${f}" aria-checked="${pr.target === f}" aria-pressed="${pr.target === f}">${f}</button>`).join('')}</div>
      </div>
      ${sh ? `<div class="tn-verdict ${r.verdict}"><b>${esc(verdict)} · ${esc(r.upscaler)} ${esc(r.scale[LANG] || r.scale.fr)}</b>${cpuNote}</div>` : ''}
    </div>`;
  if (!sh) {
    return `<div class="tn">${head}<p class="muted tn-note" data-notr>${esc(T('Pas encore de fiche pour ce jeu : conseils généraux pour ton PC.', 'No sheet for this game yet: general advice for your PC.'))}</p>
      <div class="tn-gen" data-notr>${r.generic.map((x) => `<div class="tn-card"><span class="k">${esc(x.k.toUpperCase())}</span><b>${esc(x.v)}</b><span class="muted">${esc(x.why)}</span></div>`).join('')}</div></div>`;
  }
  const known = TUNE_CUR[g.id];
  const changes = known ? r.rows.filter((x) => x.current !== undefined && String(x.current) !== String(x.rec)).length : 0;
  TUNE_LAST[g.id] = r;
  const actions = known ? `<div class="row2 tn-act" data-notr>
      <button class="btn2 pri" data-act="tune-apply"${changes ? '' : ' disabled'}>${esc(changes ? T(`Appliquer les ${changes} changement(s)`, `Apply ${changes} change(s)`) : T('Déjà à jour', 'Already applied'))}</button>
      ${known.backup ? `<button class="btn2" data-act="tune-restore" title="${esc(known.backup)}">${esc(T('Remettre ma config d\'avant Ultimate', 'Restore my settings from before Ultimate'))}</button>` : ''}
      <span class="muted" style="font-size:12px">${esc(T('Ta config d\'origine est sauvegardée à côté du fichier du jeu au premier essai. Jeu fermé obligatoire.', 'Your original settings are saved next to the game\'s file the first time. The game must be closed.'))}</span>
    </div>` : '';
  const src = Object.fromEntries(sh.sources.map((x) => [x.id, x]));
  return `<div class="tn">${head}
    <p class="muted tn-note" data-notr>${known ? esc(T(`${changes} réglage(s) diffèrent de ta config actuelle.`, `${changes} setting(s) differ from your current config.`)) : esc(T('Config actuelle du jeu introuvable : seuls les conseils sont affichés.', 'Current game config not found: showing recommendations only.'))}</p>
    ${actions}
    <div class="tn-table" role="table" data-notr>
      <div class="tn-row th" role="row"><span role="columnheader">${esc(T('Réglage', 'Setting'))}</span><span role="columnheader">${esc(T('Actuel', 'Current'))}</span><span role="columnheader">${esc(T('Conseillé', 'Recommended'))}</span><span role="columnheader">${esc(T('Pourquoi', 'Why'))}</span></div>
      ${r.rows.map((x) => {
        const diff = known && x.current !== undefined && String(x.current) !== String(x.rec);
        return `<div class="tn-row${diff ? ' diff' : ''}" role="row"><span role="cell">${esc(x.label)}</span><span role="cell" class="muted">${known ? esc(tv(x.current)) : '—'}</span><span role="cell"><b>${esc(tv(x.rec))}</b></span><span role="cell" class="muted">${esc(x.reason)}${(x.src || []).length ? ` <span class="tn-src">${x.src.map((k) => esc(k.toUpperCase())).join(' · ')}</span>` : ''}</span></div>`;
      }).join('')}
    </div>
    <p class="muted tn-foot" data-notr>${esc(T('Sources :', 'Sources:'))} <br>${sh.sources.map((x) => `<button class="alink" data-act="url" data-v="${esc(x.url)}" style="min-height:0">${esc(x.id.toUpperCase())} · ${esc(x.name)}</button>`).join('<br>')}<br>${esc(T('Estimations sans chiffres d\'images/s promis.', 'Estimates, no promised FPS numbers.'))}</p></div>`;
}
async function tuneWrite(g, restore) {
  const sh = sheetFor(g), r = TUNE_LAST[g.id];
  if (!sh || (!restore && !r)) return;
  const label = (k) => r?.rows.find((x) => x.key === k)?.label || k;
  try {
    if (restore) {
      await invoke('restore_settings', { format: sh.config.format });
      toast(T('Réglages d\'avant restaurés', 'Previous settings restored'), 5000);
    } else {
      const values = Object.fromEntries(r.rows.map((x) => [x.key, x.rec]));
      if ('MaximumFPS_Value' in values) values.MaximumFPS_OnOff = true;
      const res = await invoke('apply_settings', { format: sh.config.format, values });
      const skipped = res.skipped.filter((k) => k !== 'MaximumFPS_OnOff');
      toast(`${T(`${res.changed.length} réglage(s) appliqué(s)`, `${res.changed.length} setting(s) applied`)}${skipped.length ? T(` · à régler dans le jeu : ${skipped.map(label).join(', ')}`, ` · set in game: ${skipped.map(label).join(', ')}`) : ''}`, 7000);
    }
  } catch (err) {
    toast(String(err) === 'game-running' ? T(`Ferme ${g.name} d'abord : il réécrit ses réglages en quittant`, `Close ${g.name} first: it rewrites its settings when it quits`) : String(err), 6000);
  }
  delete TUNE_CUR[g.id];
  ensureTune(g);
}
function setTune(g, patch) {
  S.user.tuning = { ...(S.user.tuning || {}), [g.id]: { ...tunePrefs(g), ...patch } };
  clearTimeout(setTune.t); setTune.t = setTimeout(saveUser, 400);
  renderGame();
}

function memoPanel(g) {
  const memo = S.memos[g.id] || '';
  return `<div class="memo-tab">
    <label for="memo-ta" class="sr">Mémo</label>
    <textarea id="memo-ta" rows="6" placeholder="Écris quelque chose…">${esc(memo)}</textarea>
    <div class="btns"><button class="save" data-act="save-memo">Enregistrer</button><span class="muted" id="memo-state">${memo ? 'Enregistré' : ''}</span></div>
  </div>`;
}

function renderGame() { keepScroll($('#game'), paintGame); optsSlot(); const g = cur(); if (g) paintMem(g); }
function paintGame() {
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
  const tabs = [['ach', `${T('Succès', 'Achievements')}${a ? ` · ${a[0]}/${a[1]}` : ''}`], ['news', 'Actus'], ['shots', 'Captures'], ['tune', T('Réglages', 'Settings')], ['review', 'Mon avis'], ['memo', 'Mémo']];
  const body = { ach: achPanel, news: newsPanel, shots: shotsPanel, tune: tunePanel, review: reviewPanel, memo: memoPanel }[S.tab](g);
  const title = g.logo
    ? `<img class="logo" src="${esc(th(g.logo, 900))}" alt="${esc(g.name)}" data-err="title" data-name="${esc(g.name)}">`
    : `<h1 class="title">${esc(g.name)}</h1>`;
  $('#game').innerHTML = `
    <section class="ghero">
      <div class="body">
        <div class="gmain">
          <span class="kicker"><span class="dot"></span>${g.update ? 'MISE À JOUR DISPONIBLE' : !g.installed ? 'NON INSTALLÉ' : g.lastPlayed ? ago(g.lastPlayed).toUpperCase() : ''}</span>
          ${title}
          <div class="tags">
            <span class="tag glass">${SRC[g.source]}</span>
            ${g.tags.slice(0, 5).map((t) => `<button class="tag glass" data-act="gocol" data-v="${esc(t)}" style="color:${catColor(t)}">${esc(lbl(t))}</button>`).join('')}
          </div>
          <div class="btns">
            <button class="play" data-act="play"${isAdmin(g) ? ` title="${esc(T('Lancement en admin (UAC)', 'Runs as admin (UAC)'))}"` : ''}>${g.installed ? icon.play + 'Jouer' : icon.dl + 'Installer'}${g.installed && isAdmin(g) ? `<span class="adm">${icon.shield}</span>` : ''}</button>
            ${g.update && g.source === 'steam' ? `<button class="ghost glass" data-act="url" data-v="steam://nav/downloads">${icon.upd}Mettre à jour</button>` : ''}
            <button class="ibtn glass round" data-act="fav" aria-label="${isFav(g) ? 'Retirer des favoris' : 'Ajouter aux favoris'}" style="color:${isFav(g) ? '#FFD45C' : '#fff'}">${icon.star(isFav(g))}</button>
            <div class="anchor">
              <button class="ibtn glass round" data-act="menu" data-menu="opts" aria-label="Options du jeu" aria-expanded="${S.menu === 'opts'}">${icon.opts}</button>
              <div id="opts-menu"></div>
            </div>
          </div>
          <span class="memhint" id="memhint" data-notr hidden></span>
          <div class="stats glass">
            <div><span class="k">TEMPS DE JEU</span><span class="v">${g.playtimeMin ? fmtH(g.playtimeMin) : '—'}</span></div>
            <button data-act="tab" data-v="ach"><span class="k">SUCCÈS ›</span><span class="v">${a ? `${a[0]} / ${a[1]}<span class="minibar"><span style="width:${p}%"></span></span>` : '—'}</span></button>
            <div><span class="k">DERNIÈRE SESSION</span><span class="v">${ago(g.lastPlayed)}</span></div>
            <div><span class="k">TAILLE</span><span class="v">${g.installed ? size(g.size) : 'Non installé'}</span></div>
          </div>
          <div class="rate glass" role="group" aria-label="Ma note">
            <span class="stars">${starsHtml(rating(g.id)?.stars || 0)}</span>
            <button class="heart" data-act="heart" aria-pressed="${!!rating(g.id)?.heart}" aria-label="Coup de cœur">${heartSvg(!!rating(g.id)?.heart)}</button>
            ${rating(g.id)?.stars ? `<span class="rv">${dec(rating(g.id).stars)}</span>` : ''}
          </div>
        </div>
        <div class="gside">
          ${hltbCard(g)}
          ${playing.length ? `<div class="card glass"><span class="k">EN JEU EN CE MOMENT</span>${playing.map((f) => `<span class="fr"><img src="${esc(f.avatar)}" alt="">${esc(f.name)}</span>`).join('')}</div>` : ''}
          ${memo ? `<div class="card glass"><span class="k">${icon.pen}MÉMO</span><span class="memo">${esc(memo)}</span><button class="alink" data-act="tab" data-v="memo">Modifier</button></div>`
            : `<button class="ibtn glass memo-add" data-act="tab" data-v="memo" aria-label="Mémo" title="Mémo">${icon.pen}</button>`}
          ${n ? `<button class="card glass newscard" data-act="tab" data-v="news"><span class="k">${T('ACTU', 'NEWS')} · ${esc(ago(n.date).toUpperCase())}</span><span class="t">${esc(n.title)}</span><span class="alink" style="min-height:0">Lire →</span></button>` : ''}
        </div>
      </div>
    </section>
    <section class="wrap" id="panel">
      <div class="panel glass">
        <div class="tabs" role="tablist">${tabs.map(([k, x]) => `<button class="tab" role="tab" data-act="tab" data-v="${k}" aria-selected="${S.tab === k}">${x}</button>`).join('')}<span class="gname">${esc(g.name)}</span></div>
        ${body}
      </div>
    </section>
    ${similar.length ? `<section class="similar"><div class="sec-head"><div><h2>${esc(lbl(g.tags[0]))}</h2></div><button class="alink" data-act="gocol" data-v="${esc(g.tags[0])}">Voir la collection →</button></div>
      <div class="grid row">${similar.map(cover).join('')}</div></section>` : ''}`;
}

// ---------- HALL OF FAME (100 %) ----------

const perfectGames = () => S.games.filter((g) => { const a = S.achsum[g.id]; return a && a[1] && a[0] === a[1] && !isExtra(g); });
async function loadTrophyDates() {
  for (const g of perfectGames()) {
    if (S.trophyDates[g.id] !== undefined) continue;
    S.trophyDates[g.id] = 0;
    invoke('achievements', { id: g.id }).then((l) => {
      S.trophyDates[g.id] = Math.max(0, ...l.list.map((x) => x.unlockTime || 0));
      if (S.view === 'trophy') renderTrophy();
    }).catch(() => {});
  }
}
function renderTrophy() {
  theme('#F5C84C', '#140F04');
  setBg('', true);
  const list = perfectGames().sort((a, b) => (S.trophyDates[b.id] || 0) - (S.trophyDates[a.id] || 0) || S.achsum[b.id][1] - S.achsum[a.id][1]);
  const ach = list.reduce((n, g) => n + S.achsum[g.id][1], 0);
  const hours = list.reduce((n, g) => n + g.playtimeMin, 0);
  $('#trophy').innerHTML = `
    <section class="hof-head">
      <span class="hof-crown" aria-hidden="true"><svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.8 11H4.8z"/><rect x="4.8" y="19.2" width="14.4" height="1.8" rx=".9"/></svg></span>
      <h1>Panthéon</h1>
      <div class="hof-kpis"><span><b>${list.length}</b>${T('jeux à 100 %', 'games at 100%')}</span><span><b>${ach.toLocaleString(LOCALE)}</b>${T('succès', 'achievements')}</span><span><b>${fmtH(hours)}</b>${T('de jeu', 'played')}</span></div>
    </section>
    <section class="hof-grid">
      ${list.map((g, i) => `<button class="hof-card" data-act="sel" data-id="${esc(g.id)}" style="--g:${g.accent || '#F5C84C'}">
        <span class="hof-art">${g.cover ? `<img src="${esc(coverSrc(g))}" alt="" loading="lazy">` : `<span class="ph">${esc(g.name)}</span>`}
          <span class="hof-badge">${icon.crown} 100%</span>${i < 3 ? `<span class="hof-rank">#${i + 1}</span>` : ''}</span>
        <span class="hof-meta"><b class="nm">${esc(g.name)}</b>
          <span>${S.achsum[g.id][1]} ${T('succès', S.achsum[g.id][1] > 1 ? 'achievements' : 'achievement')} · ${fmtH(g.playtimeMin)}</span>
          <span class="hof-date">${S.trophyDates[g.id] ? day(S.trophyDates[g.id]) : ''}</span></span>
      </button>`).join('') || `<div class="empty">${T('Aucun jeu à 100 % pour l’instant.', 'No 100% games yet.')}</div>`}
    </section>`;
}

// ---------- STATS ----------

function ratingsBox() {
  const rs = Object.entries(S.user.ratings || {}).filter(([id, r]) => r.stars && S.games.some((g) => g.id === id));
  if (!rs.length) return '<section class="panel glass sbox"><h3>Mes notes</h3><span class="muted">—</span></section>';
  const buckets = Array.from({ length: 10 }, (_, i) => rs.filter(([, r]) => Math.round(r.stars * 2) === i + 1).length);
  const mx = Math.max(...buckets, 1);
  const avg = rs.reduce((s, [, r]) => s + r.stars, 0) / rs.length;
  const hearts = Object.values(S.user.ratings).filter((r) => r.heart).length;
  return `<section class="panel glass sbox"><h3>Mes notes</h3>
    <div class="rhist">${buckets.map((n, i) => `<span title="${(i + 1) / 2} ★ : ${n}" style="height:${Math.max(3, (n / mx) * 100)}%"></span>`).join('')}</div>
    <div class="rhl"><span class="rt">★</span><span class="muted">${rs.length} · ★ ${dec(avg)} · ♥ ${hearts}</span><span class="rt">★★★★★</span></div>
  </section>`;
}

function renderStats() {
  theme('#7C9CFF');
  setBg('', true);
  const all = S.games.filter(isGame);
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
    <section class="home-head"><div><h1>Statistiques</h1></div>
      <div class="kpis glass">
        <div><span class="k">TOTAL</span><span class="v">${fmtH(total)}</span><span class="muted" style="font-size:12px">${(total / 60 / 24).toFixed(0)} ${T('j', 'd')}</span></div>
        <div><span class="k">2 DERNIÈRES SEMAINES</span><span class="v">${recent ? fmtH(recent) : '—'}</span></div>
        <div><span class="k">JOUÉS EN ${year}</span><span class="v">${thisYear.length}</span></div>
        <div><span class="k">SÉRIE</span><span class="v">${streak}<small>${T('j', 'd')}</small></span></div>
      </div></section>
    <div class="stat-grid">
      <section class="panel glass sbox"><h3>Top 12</h3>
        ${top.map((g) => `<button class="hbar" data-act="sel" data-id="${esc(g.id)}"><img src="${esc(th(g.cover, 120))}" alt=""><span class="hn">${esc(g.name)}</span>
          <span class="ht"><span style="width:${(g.playtimeMin / max) * 100}%;background:${g.accent || '#7C9CFF'}"></span></span><b>${fmtH(g.playtimeMin)}</b></button>`).join('')}
      </section>
      <div style="display:flex;flex-direction:column;gap:20px">
        <section class="panel glass sbox"><h3>30 derniers jours</h3>
          ${last30.length > 1 ? `<div class="vbars">${last30.map(([d, m]) => `<span title="${d} · ${fmtH(m)}" style="height:${Math.max(2, (m / dmax) * 100)}%"></span>`).join('')}</div>`
            : '<span class="muted">Dès demain.</span>'}
          ${recentTop.length ? `<h3 style="margin-top:12px">Ces 2 semaines</h3>${recentTop.map((g) => `<span class="mini"><b>${esc(g.name)}</b><span>${fmtH(g.recentMin)}</span></span>`).join('')}` : ''}
        </section>
        <section class="panel glass sbox"><h3>Par genre</h3>
          ${cats.map(([c, m]) => `<span class="cbar"><span class="cn" style="color:${catColor(c)}">${esc(lbl(c))}</span><span class="ht"><span style="width:${(m / catMax) * 100}%;background:${catColor(c)}"></span></span><b>${fmtH(m)}</b></span>`).join('')}
        </section>
        ${ratingsBox()}
        <section class="panel glass sbox"><h3>Par plateforme</h3>
          <div class="split">${bySrc.map(([k, m]) => `<span style="flex:${m};background:${{ steam: '#5B9DFF', epic: '#E6E6EA', gog: '#C97CF0' }[k]}" title="${SRC[k]}"></span>`).join('')}</div>
          ${bySrc.map(([k, m]) => `<span class="mini"><b>${SRC[k]}</b><span>${fmtH(m)} · ${Math.round((m / total) * 100)}${PS}%</span></span>`).join('')}
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
      <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="t">${esc(x.name)}</span><span class="s">${esc(untilTxt(x))}</span></span>
      ${x.upcoming ? '' : x.owned ? '<span class="tagown" style="margin-left:auto">DÉJÀ À TOI</span>' : `<button class="claim" data-act="url" data-v="${esc(x.url)}">Récupérer</button>`}
    </div>`;
  const sec = (store, list, empty) => `<span class="mh">${store}</span>${list.length ? list.map(row).join('') : `<span class="muted" style="padding:6px 12px 10px">${empty}</span>`}`;
  const loading = S.free === null && S.steamFree === null && S.gogFree === null;
  $('#free-menu').innerHTML = `<div class="menu solid" style="right:0;top:54px;width:460px;max-height:75vh;overflow:auto;padding:12px">
    ${loading ? '<span class="muted" style="padding:12px">Chargement…</span>' : `
    ${sec('EPIC', all.filter((x) => x.store === 'Epic' && !x.upcoming), S.free === null ? 'Chargement…' : '—')}
    ${all.some((x) => x.store === 'Epic' && x.upcoming) ? sec('EPIC · BIENTÔT', all.filter((x) => x.store === 'Epic' && x.upcoming), '') : ''}
    <div class="sep"></div>${sec('STEAM', all.filter((x) => x.store === 'Steam'), '—')}
    <div class="sep"></div>${sec('GOG', all.filter((x) => x.store === 'GOG'), '—')}`}
  </div>`;
}

function renderFriends() {
  if (S.menu !== 'friends') { $('#friends-menu').innerHTML = ''; return; }
  const f = S.friends;
  const st = (x) => (x.game ? `<span style="color:#6EE7A8">${esc(x.game)}</span>` : x.state ? '<span style="color:#8DB8FF">En ligne</span>' : esc(ago(x.lastOff)));
  $('#friends-menu').innerHTML = `<div class="menu solid" style="right:0;top:54px;width:360px;max-height:70vh;overflow:auto;padding:10px">
    <span class="mh">AMIS STEAM</span>
    ${f === null ? '<span class="muted" style="padding:12px">Chargement…</span>' : !f.length ? `<span class="muted" style="padding:12px">${S.acc.steamKey ? 'Aucun ami visible (liste privée ?).' : 'Ajoute ta clé Steam dans les Paramètres.'}</span>`
      : f.map((x) => {
        const g = x.appid && S.games.find((y) => y.steamAppid === x.appid);
        return `<${g ? `button class="mi fitem" data-act="sel" data-id="${esc(g.id)}"` : 'div class="mi fitem"'}><img src="${esc(x.avatar)}" alt="" loading="lazy"><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(x.name)}</b><span class="s">${st(x)}</span></span></${g ? 'button' : 'div'}>`;
      }).join('')}
  </div>`;
}

/** Yes / no question inside Ultimate (no system dialog). */
function askConfirm(text, ok) {
  return new Promise((done) => { S.confirm = { text, ok, done }; S.modal = 'confirm'; renderModal(); setTimeout(() => $('[data-act="confirm-no"]')?.focus(), 30); });
}
function closeConfirm(yes) {
  const c = S.confirm; S.confirm = null; S.modal = null; renderModal(); c?.done(yes);
}

function renderModal() {
  const m = $('#modal');
  if (!S.modal) { m.innerHTML = ''; return; }
  if (S.modal === 'confirm' && S.confirm) {
    m.innerHTML = `<div class="overlay" data-act="confirm-no"><div class="dialog solid" role="alertdialog" aria-modal="true" data-notr style="width:min(480px,100%)">
      <h2 style="margin:0;font-size:20px">${icon.shield} ${esc(S.confirm.text)}</h2>
      <div class="row2" style="justify-content:flex-end"><button class="btn2" data-act="confirm-no">${esc(T('Annuler', 'Cancel'))}</button><button class="btn2 pri" data-act="confirm-yes">${esc(S.confirm.ok)}</button></div>
    </div></div>`;
    return;
  }
  if (S.modal === 'editgame' && S.edit) {
    const e = S.edit;
    m.innerHTML = `<div class="overlay" data-act="close-modal"><div class="dialog solid" role="dialog" aria-modal="true" aria-label="Modifier le jeu">
      <h2 style="margin:0">Modifier le jeu</h2>
      <span class="muted" style="word-break:break-all">${esc(e.exe || '')}</span>
      <label for="eg-name">Nom</label><input id="eg-name" type="text" value="${esc(e.name)}">
      <label for="eg-q">Jeu Steam associé</label>
      <div class="row2"><input id="eg-q" type="search" value="${esc(e.q ?? e.name)}" style="flex:1"><button class="btn2" data-act="eg-search">Chercher</button></div>
      <div class="hits">${(e.hits || []).map((h) => `<button class="hit${e.appid === h.id ? ' on' : ''}" data-act="eg-pick" data-v="${h.id}"><img src="${esc(h.img)}" alt="">${esc(h.name)}</button>`).join('') || (e.hits ? '<span class="muted">Aucun résultat.</span>' : '')}</div>
      <span class="muted">${e.appid ? `Steam #${e.appid}` : '—'} <button class="alink" data-act="eg-none" style="min-height:0">Aucun</button></span>
      <div class="row2" style="justify-content:space-between"><button class="btn2 danger" data-act="eg-remove">Retirer de la bibliothèque</button>
        <span class="row2"><button class="btn2" data-act="close-modal">Annuler</button><button class="btn2 pri" data-act="eg-save">Enregistrer</button></span></div>
    </div></div>`;
    return;
  }
  if (S.modal.startsWith('newcol')) {
    const gid = S.modal.split('|')[1] || '';
    m.innerHTML = `<div class="overlay" data-act="close-modal"><div class="dialog solid" role="dialog" aria-modal="true" aria-label="Nouvelle collection" style="width:min(440px,100%)">
      <h2 style="margin:0">Nouvelle collection</h2>
      <label for="col-name">Nom</label><input id="col-name" type="text" maxlength="40" placeholder="Nom" autocomplete="off">
      <div class="row2">${PALETTE.map((c, i) => `<button class="swatch" data-act="colcolor" data-v="${c}" aria-label="Couleur ${i + 1}" aria-pressed="${i === 0}" style="background:${c}"></button>`).join('')}</div>
      <div class="row2" style="justify-content:flex-end"><button class="btn2" data-act="close-modal">Annuler</button><button class="btn2 pri" data-act="createcol" data-v="${esc(gid)}">Créer</button></div>
      <span class="err" id="col-err"></span></div></div>`;
    setTimeout(() => $('#col-name')?.focus(), 50);
    return;
  }
  const a = S.acc, u = S.user;
  const tog = (k, label, off = false) => `<label class="tgl${off ? ' off' : ''}"><input type="checkbox" data-pref="${k}" ${u[k] && !off ? 'checked' : ''}${off ? ' disabled' : ''}><span class="sw"></span><span><b>${label}</b></span></label>`;
  const ltog = (k, label) => `<label class="tgl"><input type="checkbox" data-lp="${k}" ${P[k] ? 'checked' : ''}><span class="sw"></span><span><b>${label}</b></span></label>`;
  const seg = (act, cur, opts, label) => `<div class="fseg glass" role="radiogroup" aria-label="${label}" style="align-self:flex-start">${opts.map(([k, x]) => `<button role="radio" data-act="${act}" data-v="${k}" aria-pressed="${cur === k}" aria-checked="${cur === k}">${x}</button>`).join('')}</div>`;
  m.innerHTML = `<div class="overlay" data-act="close-modal">
    <div class="dialog solid" role="dialog" aria-modal="true" aria-label="Paramètres">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Paramètres</h2>
        <button class="ibtn glass" data-act="close-modal" aria-label="Fermer">✕</button></div>

      <div class="box"><h3>Général</h3>
        <div class="srow"><span>Langue</span>${seg('lang', LANG, [['en', 'English'], ['fr', 'Français']], 'Langue')}</div>
        ${tog('closeToTray', 'Garder en fond à la fermeture')}
        ${tog('autostart', 'Lancer avec Windows')}
        ${tog('notify', 'Notifications')}
        ${ltog('big', 'Mode manette')}
        <div class="srow"><span>v${esc(S.version || '?')}</span><span class="row2"><span class="muted" id="up-state">${S.update ? `v${esc(S.update.version)}` : ''}</span>
          ${S.update ? '<button class="btn2 pri" data-act="up-install">Mettre à jour</button>' : '<button class="btn2" data-act="up-check">Vérifier</button>'}</span></div>
      </div>

      <div class="box"><h3>Apparence</h3>
        <div class="srow"><span>Accent</span>${seg('acc-mode', P.accentMode, [['dyn', 'Auto'], ['fixed', 'Fixe']], 'Accent')}</div>
        ${P.accentMode === 'fixed' ? `<div class="row2">${PALETTE.map((c) => `<button class="swatch" data-act="acc-col" data-v="${c}" aria-label="${c}" aria-pressed="${P.accentFixed === c}" style="background:${c}"></button>`).join('')}
          <label class="swatch custom" style="background:${P.accentFixed}"><input id="acc-pick" type="color" value="${P.accentFixed}" class="sr"></label></div>` : ''}
        <div class="srow"><span>Jaquettes</span>${seg('size', P.size, [['S', 'S'], ['M', 'M'], ['L', 'L']], 'Jaquettes')}</div>
        <div class="srow"><span>Fond</span>${seg('wp-mode', P.wp, [['auto', 'Auto'], ['file', 'Image'], ['game', 'Jeu']], 'Fond')}</div>
        ${P.wp === 'file' ? `<div class="row2"><label class="btn2" for="wp-file" style="display:flex;align-items:center;cursor:pointer">Choisir…</label>
          <input id="wp-file" type="file" accept="image/*" class="sr">${wpPath ? '<button class="btn2" data-act="wp-clear">Retirer</button>' : ''}</div>` : ''}
        ${P.wp === 'game' ? `<select id="wp-game" class="sel" aria-label="Jeu">
          <option value="">—</option>
          ${S.games.filter((x) => x.hero).sort((x, y) => x.name.localeCompare(y.name, LOCALE)).map((x) => `<option value="${esc(x.id)}" ${x.id === P.wpGame ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>` : ''}
        ${P.wp !== 'auto' ? `<label for="wp-blur">Flou <span id="wp-blur-v">${P.wpBlur}</span></label><input id="wp-blur" class="range" type="range" min="0" max="40" value="${P.wpBlur}">
          <label for="wp-dim">Sombre <span id="wp-dim-v">${P.wpDim}</span></label><input id="wp-dim" class="range" type="range" min="0" max="85" value="${P.wpDim}">` : ''}
        ${ltog('glass', 'Flou des panneaux')}
        ${ltog('motion', 'Animations')}
        <span class="err" id="wp-err"></span>
      </div>

      <div class="box"><h3>Vigie ${VIG.found ? '<span class="ok">✓</span>' : ''}</h3>
        ${tog('gameMode', 'Mode jeu pendant les parties', !VIG.caps.gameMode)}
        ${tog('devGuard', 'Prévenir si des serveurs de dev tournent', !VIG.caps.devState)}
        <div class="row2"><input id="vg-path" type="text" value="${esc(u.vigiePath || '')}" placeholder="C:\\Dev\\vigie\\dist\\Vigie.exe" aria-label="Chemin de Vigie" style="flex:1"></div>
        <span class="muted" style="font-size:12px;word-break:break-all">${VIG.found ? esc(VIG.path) + (VIG.caps.devState ? '' : ` · ${esc(T('garde-fou dev : Vigie trop ancien', 'dev guard: Vigie too old'))}`) : 'Vigie introuvable : options inactives.'}</span>
      </div>

      <div class="box"><h3>Sauvegardes</h3>
        ${tog('autoBackup', 'Après chaque session')}
        <div class="row2"><input id="bk-dir" type="text" value="${esc(u.backupDir || '')}" placeholder="Documents\\Ultimate - Sauvegardes" aria-label="Dossier" style="flex:1"><button class="btn2" data-act="bkopen">Ouvrir</button></div>
      </div>

      <div class="box">
        <h3>Steam ${a.steamKey ? '<span class="ok">✓</span>' : ''}</h3>
        ${a.steamKey ? '<div class="row2"><button class="btn2" data-act="steam-del">Retirer la clé</button></div>' : `
          <div class="row2"><input id="steam-key" type="password" autocomplete="off" spellcheck="false" placeholder="Clé API" aria-label="Clé API" style="flex:1">
            <button class="btn2 pri" data-act="steam-save">OK</button></div>
          <span class="muted" style="font-size:12px"><button class="alink" data-act="url" data-v="https://steamcommunity.com/dev/apikey" style="min-height:0">Obtenir une clé ↗</button> · domaine : localhost · profil public</span>`}
        <span class="err" id="steam-err"></span>
      </div>

      <div class="box">
        <h3>Epic ${a.epic ? `<span class="ok">✓ ${esc(a.epic)}</span>` : ''}</h3>
        ${a.epic ? '<div class="row2"><button class="btn2" data-act="epic-off">Déconnecter</button></div>' : `
          <div class="row2"><button class="btn2" data-act="epic-login">Connexion ↗</button>
            <input id="epic-code" type="password" autocomplete="off" spellcheck="false" placeholder="authorizationCode" aria-label="Code" style="flex:1">
            <button class="btn2 pri" data-act="epic-save">OK</button></div>`}
        <span class="err" id="epic-err"></span>
      </div>
    </div></div>`;
}

// ---------- navigation ----------

function render() {
  document.body.classList.toggle('home', S.view === 'home');
  document.body.classList.toggle('big', !!P.big);
  document.body.classList.toggle('noglass', !P.glass);
  document.body.classList.toggle('nomotion', !P.motion);
  for (const v of ['home', 'game', 'stats', 'trophy']) $('#' + v).hidden = S.view !== v;
  if (S.view !== 'trophy') $('#trophy').innerHTML = '';
  if (S.view !== 'game') $('#game').innerHTML = '';
  if (S.view !== 'stats') $('#stats').innerHTML = '';
  renderTop();
  if (S.view === 'home') renderHome(); else if (S.view === 'game') renderGame(); else if (S.view === 'trophy') renderTrophy(); else renderStats();
  renderFree(); renderFriends(); renderModal();
}
function select(id) {
  if (S.view === 'home') S.homeY = window.scrollY;
  S.sel = id; S.view = 'game'; S.openNews = 0; S.menu = null; S.sub = null; S.achF = 'all'; S.tab = 'ach'; S.achShow = 9;
  render();
  window.scrollTo({ top: 0 });
  const g = cur();
  ensureNews(g); ensureAch(g); ensureHltb(g); if (g?.source === 'steam') ensureShots(g);
  if (g?.installed) { devFetch(); memFetch(g); }
}
function goHome() {
  const back = S.view !== 'home';
  S.view = 'home'; S.menu = null; S.sub = null;
  if (S.homeDirty || !$('#home').innerHTML) {
    S.homeDirty = false;
    render();
    window.scrollTo({ top: back ? S.homeY : 0, behavior: 'instant' });
    paintGrid(true);
    return;
  }
  // unchanged: just show it again (images already decoded), restore theme and position
  document.body.classList.add('home');
  for (const v of ['home', 'game', 'stats', 'trophy']) $('#' + v).hidden = v !== 'home';
  $('#game').innerHTML = ''; $('#stats').innerHTML = ''; $('#trophy').innerHTML = '';
  renderTop(); homeTheme(); renderMenus();
  window.scrollTo({ top: back ? S.homeY : 0, behavior: 'instant' });
  paintGrid();
}

async function refresh(force = false) {
  S.busy = true; $('#refresh-btn').classList.add('spin'); if (S.view === 'home') renderHome();
  try { await invoke('refresh', { force }); } catch (e) { toast(String(e)); }
  S.busy = false; $('#refresh-btn').classList.remove('spin'); if (S.view === 'home') renderHome();
  invoke('sync_achievements').catch(() => {});
  invoke('get_history').then((h) => { S.history = h || {}; }).catch(() => {});
}

async function saveMemo() {
  const g = cur(); const ta = $('#memo-ta'); if (!g || !ta) return;
  const text = ta.value.trim();
  await invoke('set_memo', { id: g.id, text });
  if (text) S.memos[g.id] = text; else delete S.memos[g.id];
  S.homeDirty = true;
  toast(text ? 'Enregistré' : 'Effacé');
  renderGame();
}

async function launch(g, el) {
  if (!g || devPrompt.end) return;
  el?.classList.remove('launching'); void el?.offsetWidth; el?.classList.add('launching');
  if (g.installed && S.user.devGuard && VIG.caps.devState) {
    // usually already fetched (hover, game page): otherwise wait 350 ms at most, then play anyway
    const st = await within(devFetch(), 350);
    if (devWorth(st) && await devPrompt(st)) { invoke('dev_kill').catch(() => {}); DEV.at = 0; toast(T('Arrêt des serveurs de dev…', 'Stopping dev servers…')); }
  }
  try { await invoke('launch', { id: g.id }); toast(g.installed ? `${g.name}…` : 'Installation…'); }
  catch (err) {
    if (String(err) === 'exe-changed') {
      // the exe was replaced since it was added: never elevate it silently
      if (!(await askConfirm(T(`L'exe de ${g.name} a changé depuis son ajout. Le lancer en admin ?`, `${g.name}'s exe changed since it was added. Run it as admin?`), T('Lancer en admin', 'Run as admin')))) return;
      try { await invoke('launch', { id: g.id, confirm: true }); toast(`${g.name}…`); } catch (e2) { toast(String(e2) === 'uac-refused' ? T('Lancement annulé : droits admin refusés', 'Launch cancelled: admin rights refused') : String(e2)); }
      return;
    }
    toast(String(err) === 'uac-refused' ? T('Lancement annulé : droits admin refusés', 'Launch cancelled: admin rights refused') : String(err));
  }
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
  if (!el) { if (S.menu && !inMenu) { S.menu = null; S.sub = null; renderMenus(); } return; }
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
      renderMenus(); return;
    case 'sub': S.sub = S.sub === v ? null : v; optsSlot(); return;
    case 'tune-fps': setTune(g, { target: +v }); return;
    case 'dev-kill': invoke('dev_kill').catch(() => {}); DEV.at = 0; toast(T('Arrêt des serveurs de dev…', 'Stopping dev servers…')); return;
    case 'confirm-yes': closeConfirm(true); return;
    case 'confirm-no': if (e.target.closest('.dialog') && el.classList.contains('overlay')) return; closeConfirm(false); return;
    case 'tune-apply': tuneWrite(g, false); return;
    case 'tune-restore': tuneWrite(g, true); return;
    case 'tab': S.tab = v; S.menu = null; if (v === 'shots') ensureShots(g); if (v === 'tune') ensureTune(g); renderGame(); $('#panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (v === 'memo') setTimeout(() => $('#memo-ta')?.focus(), 350); return;
    case 'achf': S.achF = v; S.achShow = 9; renderGame(); return;
    case 'achmore': S.achShow += 30; renderGame(); return;
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
      saveUser(); S.menu = null; toast(i >= 0 ? 'Affiché' : 'Masqué'); renderGame(); return;
    }
    case 'togcol': {
      const c = S.user.collections.find((x) => x.name === v); if (!c) return;
      const i = c.ids.indexOf(g.id); if (i >= 0) c.ids.splice(i, 1); else c.ids.push(g.id);
      saveUser(); optsSlot(); return;
    }
    case 'newcol': S.modal = 'newcol|' + (v || ''); S.menu = null; S.newColor = PALETTE[0]; renderModal(); return;
    case 'colcolor': S.newColor = v; document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.v === v))); return;
    case 'createcol': {
      const name = $('#col-name').value.trim();
      if (!name) { $('#col-err').textContent = 'Donne un nom à la collection.'; return; }
      if (S.user.collections.some((x) => x.name.toLowerCase() === name.toLowerCase())) { $('#col-err').textContent = 'Cette collection existe déjà.'; return; }
      S.user.collections.push({ name, color: S.newColor || PALETTE[0], ids: v ? [v] : [] });
      saveUser(); S.modal = null; toast('Créée'); render(); return;
    }
    case 'delcol': S.user.collections = S.user.collections.filter((x) => 'c:' + x.name !== v); S.col = 'Tout'; saveUser(); renderHome(); return;
    case 'backup': S.menu = null; renderGame(); toast('Sauvegarde…');
      invoke('backup_save', { id: g.id }).then((m) => toast(m)).catch((err) => toast(String(err))); return;
    case 'bkopen': invoke('open_backups').catch((err) => toast(String(err))); return;
    case 'src': S.src = v; S.col = 'Tout'; if (S.view !== 'home') goHome(); else render(); return;
    case 'col': S.col = v; renderHome(); $('#lib')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    case 'gocol': S.col = v; S.view = 'home'; render(); $('#lib')?.scrollIntoView({ behavior: 'smooth' }); return;
    case 'sort': S.sort = v; S.dir = 'desc'; autoLayout(); renderHome(); return;
    case 'layout': S.layout = v; renderHome(); return;
    case 'sortdir': S.dir = v; renderHome(); return;
    case 'kpi': if (S.sort === v) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = v; S.dir = 'desc'; } S.col = 'Tout'; autoLayout(); renderHome(); $('#lib')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    case 'trophy': S.view = 'trophy'; S.homeY = window.scrollY; render(); window.scrollTo({ top: 0 }); loadTrophyDates(); return;
    case 'soft': S.showSoft = !S.showSoft; renderHome(); return;
    case 'refresh': refresh(); return;
    case 'rescan': S.menu = null; refresh(true); toast('…'); return;
    case 'settings': S.modal = 'settings'; S.menu = null; await Promise.all([loadAccounts(), loadVigie()]); renderModal(); return;
    case 'admin': {
      const on = !isAdmin(g);
      S.user.adminGames = { ...(S.user.adminGames || {}), [g.id]: on };
      saveUser(); toast(on ? T('Lancement en admin', 'Runs as admin') : T('Lancement normal', 'Runs normally')); renderGame(); return;
    }
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
      try { const name = await invoke('epic_connect', { code }); await loadAccounts(); renderModal(); toast(`Epic ✓ ${name || ''}`); S.ach = {}; refresh(); }
      catch (err) { $('#epic-err').textContent = String(err); }
      return;
    }
    case 'epic-off': await invoke('epic_disconnect'); await loadAccounts(); renderModal(); return;
    case 'rate': {
      const r = el.getBoundingClientRect();
      const val = +v - (e.clientX - r.left < r.width / 2 ? 0.5 : 0);
      const cur0 = rating(g.id) || {};
      const stars = cur0.stars === val ? 0 : val;
      S.user.ratings = { ...(S.user.ratings || {}), [g.id]: { ...cur0, stars, date: Math.floor(Date.now() / 1000) } };
      saveUser(); renderGame(); return;
    }
    case 'heart': {
      const cur0 = rating(g.id) || {};
      S.user.ratings = { ...(S.user.ratings || {}), [g.id]: { ...cur0, heart: !cur0.heart, date: cur0.date || Math.floor(Date.now() / 1000) } };
      saveUser(); renderGame(); return;
    }
    case 'save-review': {
      const cur0 = rating(g.id) || {};
      S.user.ratings = { ...(S.user.ratings || {}), [g.id]: { ...cur0, review: $('#review-ta').value.trim(), date: Math.floor(Date.now() / 1000) } };
      saveUser(); toast('Enregistré'); renderGame(); return;
    }
    case 'addgame': {
      const id = await invoke('add_custom').catch((err) => { toast(String(err)); return null; });
      if (!id) return;
      toast('Ajouté');
      await refresh();
      openEdit(id);
      return;
    }
    case 'editgame': S.menu = null; openEdit(g.id); return;
    case 'removegame': await invoke('remove_custom', { id: g.id }); S.games = S.games.filter((x) => x.id !== g.id); toast('Jeu retiré'); goHome(); return;
    case 'eg-search': {
      const q = $('#eg-q').value.trim(); S.edit.name = $('#eg-name').value; S.edit.q = q;
      S.edit.hits = await invoke('steam_search', { q }).catch(() => []); renderModal(); return;
    }
    case 'eg-pick': S.edit.appid = +v; S.edit.name = $('#eg-name').value; renderModal(); return;
    case 'eg-none': S.edit.appid = null; S.edit.name = $('#eg-name').value; renderModal(); return;
    case 'eg-save': {
      const name = $('#eg-name').value.trim() || S.edit.name;
      await invoke('update_custom', { id: S.edit.id, name, steamAppid: S.edit.appid || null });
      S.modal = null; renderModal(); toast('Enregistré'); await refresh(); if (S.view === 'game') renderGame(); return;
    }
    case 'eg-remove':
      await invoke('remove_custom', { id: S.edit.id }); S.modal = null; renderModal();
      S.games = S.games.filter((x) => x.id !== S.edit.id); toast('Jeu retiré'); goHome(); return;
    case 'lang': S.user.lang = v; await invoke('set_user', { u: S.user }).catch(() => {}); setLang(v); return;
    case 'acc-mode': P.accentMode = v; savePrefs(); renderModal(); render(); return;
    case 'acc-col': P.accentFixed = v; savePrefs(); renderModal(); render(); return;
    case 'size': P.size = v; savePrefs(); renderModal(); render(); return;
    case 'up-check': {
      commitSettingsText();
      const st = $('#up-state'); st.textContent = 'Recherche…';
      try { S.update = await invoke('check_update'); st.textContent = S.update ? `v${S.update.version}` : T('À jour', 'Up to date'); renderModal(); renderUpdPill(); }
      catch (err) { st.textContent = String(err); }
      return;
    }
    case 'up-install': toast('Téléchargement de la mise à jour…'); invoke('install_update').catch((err) => toast(String(err))); return;
    case 'wp-mode': P.wp = v; savePrefs(); renderModal(); if (S.view === 'home') renderHome(); return;
    case 'wp-clear': await invoke('set_wallpaper', { dataUrl: '' }); wpPath = null; wpTint = null; renderModal(); if (S.view === 'home') renderHome(); return;
  }
  if (S.menu) { S.menu = null; S.sub = null; renderMenus(); }
});

function openEdit(id) {
  const g = S.games.find((x) => x.id === id);
  if (!g) return;
  S.edit = { id, name: g.name, exe: g.launch, appid: g.steamAppid || null, q: g.name, hits: null };
  S.modal = 'editgame'; renderModal();
  invoke('steam_search', { q: g.name }).then((h) => { if (S.edit?.id === id) { S.edit.hits = h; renderModal(); } }).catch(() => {});
}
function renderUpdPill() {
  const b = $('#upd-pill'); if (!b) return;
  b.hidden = !S.update;
  if (S.update) b.innerHTML = `${icon.upd} Mise à jour ${esc(S.update.version)}`;
}

function commitSettingsText() {
  const d = $('#bk-dir');
  if (d && (d.value.trim() || null) !== (S.user.backupDir || null)) { S.user.backupDir = d.value.trim() || null; saveUser(); }
  const vp = $('#vg-path');
  if (vp && (vp.value.trim() || null) !== (S.user.vigiePath || null)) {
    S.user.vigiePath = vp.value.trim() || null;
    saveUser().then(loadVigie).then(() => { DEV.at = 0; if (S.modal === 'settings') renderModal(); });
  }
  const u = $('#up-url');
  if (u && (u.value.trim() || null) !== (S.user.updateUrl || null)) { S.user.updateUrl = u.value.trim() || null; saveUser(); }
}

let qTimer;
function searchMode() {
  const on = document.activeElement?.id === 'q' || !!S.q.trim();
  if (document.body.classList.contains('searching') === on) return;
  document.body.classList.toggle('searching', on);
  if (S.view === 'home') { window.scrollTo({ top: 0 }); layoutGrid(); paintGrid(true); }
}
$('#q').addEventListener('focus', () => { if (S.view !== 'home') { S.view = 'home'; render(); } searchMode(); });
$('#q').addEventListener('blur', (e) => { if (e.target.value !== S.q) e.target.value = S.q; setTimeout(searchMode, 150); });
$('#q').addEventListener('input', (e) => {
  const el = e.target;
  S.q = el.value;
  // inline completion with the best match, typed part kept, the rest selected (Tab or → accepts)
  if (e.inputType?.startsWith('insert') && el.selectionStart === el.value.length && S.q.trim()) {
    const full = completion(el.value, filtered()[0]?.name);
    if (full) { el.value = full; el.setSelectionRange(S.q.length, full.length); }
  }
  searchMode();
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { if (S.view !== 'home') { S.view = 'home'; render(); } else renderHome(); }, 80);
});
$('#q').addEventListener('keydown', (e) => {
  const el = e.target;
  const sel = el.selectionStart < el.selectionEnd && el.selectionEnd === el.value.length;
  if ((e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'End') && sel) {
    e.preventDefault(); el.setSelectionRange(el.value.length, el.value.length);
    S.q = el.value; renderHome();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const g = filtered()[0];
    if (g) { el.blur(); launch(g); }
  }
});
$('#q').addEventListener('pointerenter', () => devFetch(), { once: true });
document.addEventListener('pointerover', (e) => {
  const b = e.target.closest?.('[data-act="play"], [data-act="play-id"]');
  if (!b) return;
  devFetch();
  memFetch(b.dataset.id ? S.games.find((x) => x.id === b.dataset.id) : cur());
});
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'k') { e.preventDefault(); togglePalette(); return; }
  if (S.pal) { if (e.key === 'Escape') closePalette(); return; } // the palette handles its own keys
  if (ctrl && k === 'f') { e.preventDefault(); focusSearch(); }
  if (ctrl && e.key === ',') { e.preventDefault(); act('settings'); }
  if (e.key === 'F5') { e.preventDefault(); refresh(); }
  if (e.key === 'Escape') back();
  if (e.key === 'Enter' && S.modal?.startsWith('newcol') && document.activeElement?.id === 'col-name') $('[data-act="createcol"]').click();
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'memo-ta') saveMemo();
});
function back() {
  if (devPrompt.end) devPrompt.end(false);
  else if (S.modal === 'confirm') closeConfirm(false);
  else if (S.modal) { if (S.modal === 'settings') commitSettingsText(); S.modal = null; renderModal(); }
  else if (S.menu) { S.menu = null; S.sub = null; renderMenus(); }
  else if (S.view !== 'home') goHome();
}
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'memo-ta') $('#memo-state').textContent = 'Non enregistré';
  if (id === 'tune-s' && cur()) setTune(cur(), { slider: +e.target.value });
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
  else if (t.dataset.lp) { P[t.dataset.lp] = t.checked; savePrefs(); render(); }
  if (t.id === 'acc-pick') { P.accentFixed = t.value; savePrefs(); renderModal(); render(); }
  if (t.id === 'wp-game') { P.wpGame = t.value; savePrefs(); if (S.view === 'home') renderHome(); }
  if (t.id === 'wp-file' && t.files[0]) {
    const f = t.files[0];
    const url = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });
    try { await invoke('set_wallpaper', { dataUrl: url }); wpPath = await invoke('get_wallpaper'); await loadWpTint(); renderModal(); if (S.view === 'home') renderHome(); toast('Enregistré'); }
    catch (err) { $('#wp-err').textContent = String(err); }
  }
});

// ---------- Ctrl+K palette: games and commands, fuzzy ----------

/** Runs a data-act action as if its button had been clicked. */
function act(name, data = {}) {
  const b = document.createElement('button');
  b.dataset.act = name; Object.assign(b.dataset, data); b.hidden = true;
  document.body.append(b); b.click(); b.remove();
}
function focusSearch() { $('#q').focus(); $('#q').select(); }
function commands() {
  const g = S.view === 'game' ? cur() : null;
  const onoff = (v) => (v ? T('activé', 'on') : T('désactivé', 'off'));
  const L = [
    { t: T('Bibliothèque', 'Library'), k: 'Échap', run: goHome },
    { t: T('Rechercher dans la bibliothèque', 'Search the library'), k: 'Ctrl F', run: focusSearch },
    { t: T('Actualiser la bibliothèque', 'Refresh the library'), k: 'F5', run: () => refresh() },
    { t: T('Statistiques', 'Stats'), run: () => act('stats') },
    { t: T('Panthéon (jeux à 100 %)', 'Hall of Fame (100% games)'), run: () => act('trophy') },
    { t: T('Jeux gratuits de la semaine', 'Free games this week'), run: () => act('menu', { menu: 'free' }) },
    { t: T('Amis Steam', 'Steam friends'), run: () => act('menu', { menu: 'friends' }) },
    { t: T('Ajouter un jeu (.exe, raccourci)…', 'Add a game (.exe, shortcut)…'), run: () => act('addgame') },
    { t: T('Paramètres', 'Settings'), k: 'Ctrl ,', run: () => act('settings') },
    { t: `${T('Mode manette', 'Controller mode')} : ${onoff(P.big)}`, run: () => setBig(!P.big) },
  ];
  if (VIG.caps.gameMode) L.push({ t: `${T('Mode jeu Vigie', 'Vigie game mode')} : ${onoff(S.user.gameMode)}`, run: () => { S.user.gameMode = !S.user.gameMode; saveUser(); toast(`Vigie : ${onoff(S.user.gameMode)}`); } });
  if (VIG.caps.devState) L.push({ t: `${T('Garde-fou dev', 'Dev guard')} : ${onoff(S.user.devGuard)}`, run: () => { S.user.devGuard = !S.user.devGuard; saveUser(); toast(`${T('Garde-fou dev', 'Dev guard')} : ${onoff(S.user.devGuard)}`); } });
  if (VIG.caps.devKill) L.push({ t: T('Couper les serveurs de dev, Docker et WSL', 'Stop dev servers, Docker and WSL'), run: () => { invoke('dev_kill').catch(() => {}); DEV.at = 0; toast(T('Arrêt des serveurs de dev…', 'Stopping dev servers…')); } });
  if (g) {
    if (canAdmin(g)) L.push({ t: `${g.name} · ${T('lancer en admin', 'run as admin')} : ${onoff(isAdmin(g))}`, run: () => act('admin') });
    if (g.installed) L.push({ t: `${g.name} · ${T('sauvegarder les saves', 'back up saves')}`, run: () => act('backup') });
    if (g.installed && g.installPath) L.push({ t: `${g.name} · ${T('ouvrir le dossier', 'open folder')}`, run: () => act('folder') });
    L.push({ t: `${g.name} · ${T('mémo', 'notes')}`, run: () => act('tab', { v: 'memo' }) });
  }
  return L;
}
const CP = new Map();
const cprep = (t) => { let e = CP.get(t); if (!e) { e = prep(t); CP.set(t, e); } return e; };
function palItems(q) {
  const games = S.games.filter((g) => !isExtra(g) && !isHidden(g));
  const cmds = commands();
  if (!q.trim()) {
    const recent = games.filter((g) => g.installed && g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    return [...recent.map((g) => ({ g })), ...cmds.slice(0, 9).map((c) => ({ c }))];
  }
  const Q = query(q);
  const out = [];
  for (const g of games) { const v = rel(Q, g); if (v) out.push({ g, v: v + (g.installed ? 5 : 0) }); }
  for (const c of cmds) { const v = score(Q, cprep(c.t)); if (v) out.push({ c, v }); }
  return out.sort((a, b) => b.v - a.v || (b.g?.lastPlayed || 0) - (a.g?.lastPlayed || 0)).slice(0, 12);
}
function togglePalette() { if (S.pal) closePalette(); else openPalette(); }
function openPalette() {
  S.pal = { q: '', i: 0, items: [] };
  devFetch();
  const box = $('#palette');
  box.innerHTML = `<div class="pal-wrap" data-pal="close"><div class="pal solid" role="dialog" aria-modal="true" aria-label="${esc(T('Palette de commandes', 'Command palette'))}" data-notr>
    <div class="pal-in"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="pal-q" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(T('Jeu ou commande…', 'Game or command…'))}" aria-label="${esc(T('Jeu ou commande', 'Game or command'))}" role="combobox" aria-controls="pal-list" aria-expanded="true"></div>
    <div id="pal-list" role="listbox"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(T('choisir', 'select'))}</span><span><kbd>${T('Entrée', 'Enter')}</kbd> ${esc(T('lancer', 'run'))}</span><span><kbd>${T('Maj', 'Shift')}</kbd>+<kbd>${T('Entrée', 'Enter')}</kbd> ${esc(T('fiche du jeu', 'game page'))}</span><span><kbd>${T('Échap', 'Esc')}</kbd> ${esc(T('fermer', 'close'))}</span></div>
  </div></div>`;
  const inp = $('#pal-q');
  inp.addEventListener('input', () => { S.pal.q = inp.value; S.pal.i = 0; palList(); });
  inp.addEventListener('keydown', palKey);
  box.onclick = (e) => {
    const it = e.target.closest('[data-pi]');
    if (it) { palRun(+it.dataset.pi, e.shiftKey); return; }
    if (e.target.dataset.pal === 'close') closePalette();
  };
  box.onpointermove = (e) => { const it = e.target.closest('[data-pi]'); if (it && +it.dataset.pi !== S.pal.i) { S.pal.i = +it.dataset.pi; palSel(); } };
  palList();
  inp.focus();
}
function closePalette() { S.pal = null; $('#palette').innerHTML = ''; }
function palList() {
  const p = S.pal; p.items = palItems(p.q);
  const kbd = (k) => (k ? `<span class="pal-k">${k.split(' ').map((x) => `<kbd>${esc(x === 'Échap' ? T('Échap', 'Esc') : x)}</kbd>`).join('')}</span>` : '');
  $('#pal-list').innerHTML = p.items.map((x, i) => x.g
    ? `<div class="pal-row" role="option" data-pi="${i}" aria-selected="${i === p.i}">
        <span class="pal-ic cov">${x.g.cover ? `<img src="${esc(th(x.g.cover, 80))}" alt="" loading="lazy">` : ''}</span>
        <span class="pal-t"><b>${esc(x.g.name)}</b><span class="muted">${esc(SRC[x.g.source] || '')}${x.g.lastPlayed ? ` · ${esc(ago(x.g.lastPlayed))}` : ''}${isAdmin(x.g) ? ` · ${esc(T('admin', 'admin'))}` : ''}</span></span>
        <span class="pal-go">${x.g.installed ? T('Jouer', 'Play') : T('Installer', 'Install')}</span></div>`
    : `<div class="pal-row" role="option" data-pi="${i}" aria-selected="${i === p.i}">
        <span class="pal-ic">${icon.right}</span><span class="pal-t"><b>${esc(x.c.t)}</b></span>${kbd(x.c.k)}</div>`).join('')
    || `<div class="pal-empty muted">${esc(T('Aucun résultat.', 'No results.'))}</div>`;
}
function palSel() {
  for (const r of document.querySelectorAll('#pal-list [data-pi]')) r.setAttribute('aria-selected', String(+r.dataset.pi === S.pal.i));
  document.querySelector(`#pal-list [data-pi="${S.pal.i}"]`)?.scrollIntoView({ block: 'nearest' });
}
function palKey(e) {
  const p = S.pal, n = p.items.length;
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); if (n) { p.i = (p.i + 1) % n; palSel(); } }
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); if (n) { p.i = (p.i - 1 + n) % n; palSel(); } }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(p.i, e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
}
function palRun(i, page) {
  const x = S.pal?.items[i];
  if (!x) return;
  closePalette();
  if (x.c) x.c.run();
  else if (page) select(x.g.id);
  else launch(x.g);
}

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
    if (edge(3)) { if (S.pal) closePalette(); else togglePalette(); }
    if (edge(9)) setBig(!P.big);
    PAD.prev = Object.fromEntries(pad.buttons.map((x, i) => [i, x.pressed]));
  }
  requestAnimationFrame(pollPad);
}
addEventListener('gamepadconnected', () => { toast('Manette détectée'); });
requestAnimationFrame(pollPad);

// Broken images (CSP forbids inline onerror handlers): what to do is in data-err.
document.addEventListener('error', (e) => {
  const el = e.target;
  const how = el?.dataset?.err;
  if (!how) return;
  if (how === 'remove') el.remove();
  else if (how === 'hide') el.style.visibility = 'hidden';
  else if (how === 'title' || how === 'nm') el.replaceWith(Object.assign(document.createElement(how === 'title' ? 'h1' : 'span'), { className: how, textContent: el.dataset.name || '' }));
}, true);

// ---------- boot ----------

// Background updates (scan, achievements, colours) arrive in bursts: rebuild the library at most
// once per second, so hover effects under the cursor are not restarted again and again.
let pending = null, lastPaint = 0;
function onLibrary(list) {
  S.games = list;
  if (pending) return;
  const wait = Math.max(0, 1000 - (performance.now() - lastPaint));
  pending = setTimeout(() => {
    pending = null; lastPaint = performance.now();
    renderTop();
    if (S.view === 'home') renderHome(); else S.homeDirty = true;
  }, wait);
}

(async () => {
  const [lib, memos, achsum, user] = await Promise.all([invoke('get_cached'), invoke('get_memos'), invoke('get_achsum'), invoke('get_user')]);
  S.memos = memos; S.achsum = achsum; S.games = lib; S.user = { ...S.user, ...user };
  if (S.user.lang !== LANG) { S.user.lang = LANG; saveUser(); }
  startI18n();
  try { wpPath = await invoke('get_wallpaper'); await loadWpTint(); } catch { /* none */ }
  render();
  if (P.big) getCurrentWindow().setFullscreen(true).catch(() => {});
  await listen('library', (e) => onLibrary(e.payload));
  await listen('hw', (e) => { HW = e.payload; if (S.view === 'game' && S.tab === 'tune') renderGame(); });
  await listen('vigie', (e) => { if (e.payload?.msg) toast(`Vigie · ${e.payload.msg}`, 6000); });
  loadVigie();
  await listen('achsum', (e) => { S.achsum = e.payload; if (S.view === 'home') onLibrary(S.games); else S.homeDirty = true; });
  await loadAccounts();
  refresh();
  loadSocial();
  invoke('free_games').then((f) => { S.free = f; renderFree(); if (S.view === 'home') renderHome(); }).catch(() => {});
  invoke('steam_free_games').then((f) => { S.steamFree = f; renderFree(); if (S.view === 'home') renderHome(); }).catch(() => { S.steamFree = []; });
  invoke('app_version').then((v) => { S.version = v; }).catch(() => {});
  invoke('check_update').then((u) => { S.update = u; renderUpdPill(); if (u) toast(`Ultimate ${u.version} ✓`); }).catch(() => {});
  invoke('gog_free_games').then((f) => { S.gogFree = f; renderFree(); if (S.view === 'home') renderHome(); }).catch(() => { S.gogFree = []; });
})();
