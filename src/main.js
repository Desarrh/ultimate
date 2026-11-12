import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const S = {
  games: [], memos: {}, news: {}, free: null, achsum: {}, ach: {}, acc: { steamKey: false, steamId: null, epic: null },
  view: 'home', sel: null, q: '', src: 'all', col: 'Tout', sort: 'recent', limit: 120,
  tab: 'ach', achF: 'all', openNews: 0, menu: null, showSoft: false, busy: false, modal: false, homeY: 0,
};
const $ = (s) => document.querySelector(s);
const P = (() => { try { return { wp: 'auto', wpGame: '', wpBlur: 0, wpDim: 45, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return { wp: 'auto', wpGame: '', wpBlur: 0, wpDim: 45 }; } })();
const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(P)); } catch { /* ignore */ } };
let wpData = null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SRC = { steam: 'Steam', epic: 'Epic', gog: 'GOG' };
const CAT = {
  Tout: '#FF6B9A', Installés: '#6EE7A8', 'Avec mémo': '#FFD45C', Survie: '#3EE6A8', 'Souls-like': '#FF6B6B', Roguelite: '#FF9F43',
  Metroidvania: '#A78BFA', Horreur: '#FF5C7A', Coop: '#4CBCE6', Multijoueur: '#5B9DFF', Solo: '#F5C84C', RPG: '#F5B84C', Chill: '#C97CF0',
  Incrémental: '#7CE0F0', Puzzle: '#7BC74D', Plateformes: '#FFB86B', 'Monde ouvert': '#34D399', Construction: '#F59E0B', Stratégie: '#60A5FA',
  Simulation: '#2DD4BF', Tir: '#F87171', Course: '#FB923C', Rythme: '#E879F9', Aventure: '#FBBF24', Action: '#FB7185', Démo: '#94A3B8', Logiciel: '#7C9CFF',
};
const catColor = (c) => CAT[c] || '#B8C2D6';
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
const icon = {
  play: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  dl: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  opts: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  pen: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>',
  chev: '<svg class="chev" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg class="ck" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  folder: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trophy: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
};

const cur = () => S.games.find((g) => g.id === S.sel) || null;
const isSoft = (g) => g.tags.includes('Logiciel');
const games = () => S.games.filter((g) => !isSoft(g) || S.showSoft || S.col === 'Logiciel');
const lbl = (c) => (c === 'Logiciel' ? 'Apps' : c);
const pct = (id) => { const s = S.achsum[id]; return s && s[1] ? Math.round((s[0] / s[1]) * 100) : null; };

function toast(msg) {
  const t = $('#toast');
  t.className = 'solid on';
  t.innerHTML = `<span class="dot"></span>${esc(msg)}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'solid'), 2800);
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

// ---------- shared pieces ----------

function renderSources() {
  const base = S.games.filter((g) => !isSoft(g));
  const counts = { all: base.length };
  for (const k of Object.keys(SRC)) counts[k] = base.filter((g) => g.source === k).length;
  const items = [['all', 'Tout']].concat(Object.entries(SRC).filter(([k]) => counts[k] > 0));
  $('#sources').innerHTML = items.map(([k, l]) =>
    `<button data-act="src" data-v="${k}" aria-pressed="${S.src === k}">${l}<span class="n">${counts[k]}</span></button>`).join('');
  $('#back').hidden = S.view !== 'game';
}

function cover(g) {
  const memo = S.memos[g.id];
  const p = pct(g.id);
  return `<button class="cov${g.installed ? '' : ' notinst'}" data-act="sel" data-id="${esc(g.id)}" aria-label="${esc(g.name)}" style="--g:${g.accent || '#000'}">
    <span class="art" style="background:${g.deep || '#1A1A20'}">
      <span class="ph">${esc(g.name)}</span>
      ${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      ${g.source !== 'steam' ? `<span class="srcb">${SRC[g.source].toUpperCase()}</span>` : ''}
      ${memo ? `<span class="memob" title="A un mémo">${icon.pen}</span>` : ''}
      ${p !== null ? `<span class="pb"><span style="width:${p}%;background:${p === 100 ? '#6EE7A8' : g.accent || '#fff'}"></span></span>` : ''}
    </span>
    <span class="meta"><span class="nm">${esc(g.name)}</span><span class="h">${g.playtimeMin ? fmtH(g.playtimeMin) : ''}</span></span>
  </button>`;
}

// ---------- HOME ----------

function inCol(g, c) {
  if (c === 'Tout') return true;
  if (c === 'Installés') return g.installed;
  if (c === 'Avec mémo') return !!S.memos[g.id];
  return g.tags.includes(c);
}

function collections() {
  const base = games().filter((g) => S.src === 'all' || g.source === S.src);
  const counts = {};
  base.forEach((g) => g.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const soft = S.games.filter((g) => isSoft(g) && (S.src === 'all' || g.source === S.src));
  const list = ['Tout', 'Installés'];
  if (soft.length) list.push('Logiciel');
  if (base.some((g) => S.memos[g.id])) list.push('Avec mémo');
  Object.entries(counts).filter(([t, n]) => n >= 2 && t !== 'Logiciel' && t !== 'Démo').sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([t]) => list.push(t));
  if (counts['Démo']) list.push('Démo');
  const byRecent = [...base].sort((a, b) => b.lastPlayed - a.lastPlayed || b.playtimeMin - a.playtimeMin);
  return list.map((c) => {
    const inside = c === 'Logiciel' ? soft.sort((a, b) => b.lastPlayed - a.lastPlayed || b.playtimeMin - a.playtimeMin) : byRecent.filter((g) => inCol(g, c));
    const art = inside.filter((g) => g.cover).slice(0, 3);
    return { c, n: inside.length, art };
  });
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  let l = games().filter((g) => (S.src === 'all' || g.source === S.src) && inCol(g, S.col));
  if (q) l = l.filter((g) => g.name.toLowerCase().includes(q) || g.tags.some((t) => t.toLowerCase().includes(q)) || (S.memos[g.id] || '').toLowerCase().includes(q));
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

function renderHome() {
  const all = S.games.filter((g) => !isSoft(g));
  const total = all.reduce((s, g) => s + g.playtimeMin, 0);
  const bySrc = Object.keys(SRC).map((k) => [k, all.filter((g) => g.source === k).reduce((s, g) => s + g.playtimeMin, 0)]).filter(([, v]) => v > 0);
  const sums = Object.entries(S.achsum).filter(([id]) => all.some((g) => g.id === id)).map(([, v]) => v);
  const un = sums.reduce((s, v) => s + v[0], 0), tot = sums.reduce((s, v) => s + v[1], 0);
  const perfect = sums.filter((v) => v[1] && v[0] === v[1]).length;
  const last = [...all].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  const col = S.col;
  theme(catColor(col));
  const wpG = P.wp === 'game' && S.games.find((x) => x.id === P.wpGame);
  if (P.wp === 'file' && wpData) setBg(wpData, false, true);
  else if (wpG) setBg(wpG.hero || wpG.cover, false, true);
  else setBg(last?.hero || last?.cover, true);
  const cols = collections();
  const list = filtered();
  const shown = list.slice(0, S.limit);
  const lastMemo = last && S.memos[last.id];

  $('#home').innerHTML = `
    <section class="home-head">
      <div>
        <h1>Ta bibliothèque</h1>
        <div class="sub">${all.length} jeux · ${all.filter((g) => g.installed).length} installés${S.busy ? ' · mise à jour…' : ''}</div>
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
      ${last.hero || last.cover ? `<img class="h" src="${esc(last.hero || last.cover)}" alt="">` : ''}
      <span class="fade"></span>
      <span class="in">
        ${last.logo ? `<img class="lg" src="${esc(last.logo)}" alt="${esc(last.name)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'nm',textContent:${esc(JSON.stringify(last.name))}}))">` : `<span class="nm">${esc(last.name)}</span>`}
        <span class="meta">
          <span class="k"><span class="dot" style="background:${last.accent};box-shadow:0 0 12px ${last.accent}"></span>REPRENDRE · ${esc(ago(last.lastPlayed).toUpperCase())}</span>
          <span>${fmtH(last.playtimeMin)} de jeu${pct(last.id) !== null ? ` · ${pct(last.id)} % des succès` : ''}</span>
          ${lastMemo ? `<span class="memo">✎ ${esc(lastMemo)}</span>` : ''}
        </span>
        <span class="play sm go" data-act="play-id" data-id="${esc(last.id)}" style="background:${last.accent}">${last.installed ? icon.play + 'Jouer' : icon.dl + 'Installer'}</span>
      </span>
    </button>` : ''}

    <section class="cols-wrap">
      <div class="cols-head"><div><h2>Collections</h2><span class="muted">Rangées automatiquement à partir des tags Steam</span></div></div>
      <div class="cols" role="group" aria-label="Collections">
        ${cols.map((x) => `<button class="col" data-act="col" data-v="${esc(x.c)}" aria-pressed="${x.c === col}" style="--c:${catColor(x.c)}">
          <span class="fan">
            ${x.art[1] ? `<img class="f1" src="${esc(x.art[1].cover)}" alt="" loading="lazy">` : ''}
            ${x.art[2] ? `<img class="f3" src="${esc(x.art[2].cover)}" alt="" loading="lazy">` : ''}
            ${x.art[0] ? `<img class="f2" src="${esc(x.art[0].cover)}" alt="" loading="lazy">` : ''}
          </span>
          <span class="lbl"><b>${esc(lbl(x.c))}</b><span>${x.n}</span></span>
        </button>`).join('')}
      </div>
    </section>

    <section class="lib" id="lib">
      <div class="sec-head">
        <div><h2>${col === 'Tout' ? 'Tous les jeux' : esc(lbl(col))}</h2><span class="muted">${list.length} jeu${list.length > 1 ? 'x' : ''}${S.q ? ` pour « ${esc(S.q)} »` : ''}</span></div>
        <div class="anchor">
          <button class="glass pillbtn" data-act="menu" data-menu="sort" aria-expanded="${S.menu === 'sort'}">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
            Trier : <strong>${SORTS.find((s) => s[0] === S.sort)[1]}</strong></button>
          ${S.menu === 'sort' ? `<div class="menu solid" role="menu" style="right:0;top:54px">
            <span class="mh">TRIER PAR</span>
            ${SORTS.map(([k, l]) => `<button class="mi" role="menuitemradio" aria-checked="${S.sort === k}" data-act="sort" data-v="${k}">${l}${S.sort === k ? icon.check : ''}</button>`).join('')}
            <div class="sep"></div><span class="mh">AFFICHER</span>
            <button class="mi" data-act="soft">${S.showSoft ? 'Masquer' : 'Afficher'} les logiciels<span class="r">${S.games.filter(isSoft).length}</span></button>
          </div>` : ''}
        </div>
      </div>
      <div class="grid">${shown.length ? shown.map(cover).join('') : `<div class="empty">${S.games.length ? 'Aucun jeu ne correspond.' : S.busy ? 'Analyse de Steam, Epic et GOG…' : 'Aucun jeu détecté.'}</div>`}</div>
      ${list.length > shown.length ? `<button class="btn2 more" data-act="more">Afficher ${Math.min(120, list.length - shown.length)} jeux de plus</button>` : ''}
    </section>`;
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

function optsMenu(g) {
  return `<div class="menu solid" role="menu" style="left:0;bottom:72px">
    <span class="mh">${esc(g.name.toUpperCase())}</span>
    <button class="mi" data-act="tab" data-v="memo">Écrire un mémo</button>
    ${g.installed && g.installPath ? '<button class="mi" data-act="folder">Ouvrir le dossier du jeu</button>' : ''}
    ${g.steamAppid && g.source === 'steam' ? `<button class="mi" data-act="url" data-v="steam://nav/games/details/${g.steamAppid}">Voir dans Steam</button>` : ''}
    ${g.steamAppid ? `<button class="mi" data-act="url" data-v="https://store.steampowered.com/app/${g.steamAppid}">Page Steam du jeu</button>` : ''}
    <div class="sep"></div>
    <button class="mi" data-act="reach">Recharger les succès</button>
    <button class="mi" data-act="rescan">Rafraîchir les infos de la bibliothèque</button>
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
      <div class="fseg glass" role="group" aria-label="Filtrer">${F.map(([k, lbl]) => `<button data-act="achf" data-v="${k}" aria-pressed="${S.achF === k}">${lbl}</button>`).join('')}</div>
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

function memoPanel(g) {
  const memo = S.memos[g.id] || '';
  return `<div class="memo-tab">
    <label for="memo-ta" style="font-size:15px;font-weight:600">Où j'en suis dans ${esc(g.name)}</label>
    <textarea id="memo-ta" rows="6" placeholder="Ex. : Acte 2, juste avant le boss. Penser à équiper l'arme de feu.">${esc(memo)}</textarea>
    <div class="qchips"><span class="muted">Ajouter :</span>
      ${['Boss suivant', 'Quête en cours', 'Build / équipement', 'À faire avec les amis'].map((l) => `<button class="qchip" data-act="quick" data-v="${l}">+ ${l}</button>`).join('')}
    </div>
    <div class="btns"><button class="save" data-act="save-memo">Enregistrer le mémo</button><span class="muted" id="memo-state">${memo ? 'Enregistré' : ''}</span></div>
  </div>`;
}

function renderGame() {
  const g = cur();
  if (!g) { goHome(); return; }
  theme(g.accent, g.deep);
  setBg(g.hero || g.cover, !g.hero);
  const memo = S.memos[g.id];
  const a = S.achsum[g.id];
  const p = pct(g.id);
  const n = g.steamAppid && S.news[g.steamAppid]?.[0];
  const similar = games().filter((x) => x.id !== g.id && g.tags[0] && x.tags.includes(g.tags[0])).sort((x, y) => y.lastPlayed - x.lastPlayed || y.playtimeMin - x.playtimeMin).slice(0, 12);
  const tabs = [['ach', `Succès${a ? ` · ${a[0]}/${a[1]}` : ''}`], ['news', 'Actus & patch notes'], ['memo', 'Mémo']];
  const body = S.tab === 'ach' ? achPanel(g) : S.tab === 'news' ? newsPanel(g) : memoPanel(g);
  const title = g.logo
    ? `<img class="logo" src="${esc(g.logo)}" alt="${esc(g.name)}" onerror="this.replaceWith(Object.assign(document.createElement('h1'),{className:'title',textContent:${esc(JSON.stringify(g.name))}}))">`
    : `<h1 class="title">${esc(g.name)}</h1>`;
  $('#game').innerHTML = `
    <section class="ghero">
      <div class="body">
        <div class="gmain">
          <span class="kicker"><span class="dot"></span>${!g.installed ? 'NON INSTALLÉ' : memo ? 'REPRENDRE LA PARTIE' : g.lastPlayed ? 'DERNIÈRE SESSION · ' + ago(g.lastPlayed).toUpperCase() : 'DANS TA BIBLIOTHÈQUE'}</span>
          ${title}
          <div class="tags">
            <span class="tag glass">${SRC[g.source]}</span>
            ${g.tags.slice(0, 5).map((t) => `<button class="tag glass" data-act="gocol" data-v="${esc(t)}" style="color:${catColor(t)}">${esc(lbl(t))}</button>`).join('')}
          </div>
          <div class="btns">
            <button class="play" data-act="play">${g.installed ? icon.play + 'Jouer' : icon.dl + 'Installer'}</button>
            ${g.installed && g.installPath ? `<button class="ghost glass" data-act="folder">${icon.folder}Dossier</button>` : ''}
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
          ${memo ? `<div class="card glass"><span class="k">${icon.pen}MÉMO · OÙ J'EN SUIS</span><span class="memo">${esc(memo)}</span><button class="alink" data-act="tab" data-v="memo">Modifier le mémo ↓</button></div>`
            : `<button class="ibtn glass memo-add" data-act="tab" data-v="memo" aria-label="Écrire un mémo" title="Écrire un mémo">${icon.pen}</button>`}
          ${n ? `<button class="card glass newscard" data-act="tab" data-v="news"><span class="k">DERNIÈRE ANNONCE · ${esc(ago(n.date).toUpperCase())}</span><span class="t">${esc(n.title)}</span><span class="alink" style="min-height:0">Lire les notes →</span></button>` : ''}
        </div>
      </div>
    </section>
    <section class="wrap" id="panel">
      <div class="panel glass">
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-act="tab" data-v="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}<span class="gname">${esc(g.name)}</span></div>
        ${body}
      </div>
    </section>
    ${similar.length ? `<section class="similar"><div class="sec-head"><div><h2>Aussi dans ${esc(lbl(g.tags[0]))}</h2></div><button class="alink" data-act="gocol" data-v="${esc(g.tags[0])}">Voir la collection →</button></div>
      <div class="grid row">${similar.map(cover).join('')}</div></section>` : ''}`;
}

// ---------- free games & settings ----------

function renderFree() {
  const f = S.free;
  const now = f ? f.filter((x) => !x.upcoming) : [];
  const b = $('#free-badge');
  b.hidden = !now.length;
  b.textContent = now.length;
  if (S.menu !== 'free') { $('#free-menu').innerHTML = ''; return; }
  const row = (x) => `<div class="free-item">
      ${x.image ? `<img src="${esc(x.image)}" alt="">` : '<span style="width:110px;height:62px"></span>'}
      <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="t">${esc(x.title)}</span>
      <span class="s">${x.upcoming ? 'Gratuit à partir du' : "Gratuit jusqu'au"} ${x.until ? new Date(x.until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '—'}</span></span>
      ${x.upcoming ? '' : `<button class="claim" data-act="url" data-v="${esc(x.url)}">Récupérer</button>`}
    </div>`;
  $('#free-menu').innerHTML = `<div class="menu solid" style="right:0;top:54px;width:420px;padding:12px">
    <span class="mh">EPIC GAMES · GRATUITS CETTE SEMAINE</span>
    ${f === null ? '<span class="muted" style="padding:12px">Chargement…</span>' : now.length ? now.map(row).join('') : '<span class="muted" style="padding:12px">Rien cette semaine.</span>'}
    ${f && f.some((x) => x.upcoming) ? `<div class="sep"></div><span class="mh">BIENTÔT</span>${f.filter((x) => x.upcoming).map(row).join('')}` : ''}
  </div>`;
}

function renderModal() {
  if (!S.modal) { $('#modal').innerHTML = ''; return; }
  const a = S.acc;
  $('#modal').innerHTML = `<div class="overlay" data-act="close-modal">
    <div class="dialog solid" role="dialog" aria-modal="true" aria-label="Paramètres">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Paramètres</h2>
        <button class="ibtn glass" data-act="close-modal" aria-label="Fermer">✕</button></div>

      <div class="box">
        <h3>Steam ${a.steamKey ? '<span class="ok">· relié</span>' : ''}</h3>
        <span class="muted">Temps de jeu exact, jeux jamais lancés et succès. Compte détecté : ${a.steamId ? esc(a.steamId) : 'aucun'}.</span>
        ${a.steamKey ? `<div class="row2"><span class="ok">Clé enregistrée dans le coffre Windows.</span><button class="btn2" data-act="steam-del">Retirer la clé</button></div>` : `
          <ol>
            <li>Ouvre <button class="alink" data-act="url" data-v="https://steamcommunity.com/dev/apikey" style="min-height:0">steamcommunity.com/dev/apikey</button> et connecte-toi.</li>
            <li>Nom de domaine : mets <b>localhost</b>, accepte, puis copie la clé.</li>
            <li>Dans Steam : Profil › Modifier › Confidentialité › « Détails de jeu » sur <b>Public</b>.</li>
          </ol>
          <label for="steam-key">Clé d'API Steam</label>
          <div class="row2"><input id="steam-key" type="password" autocomplete="off" spellcheck="false" placeholder="32 caractères" style="flex:1">
            <button class="btn2 pri" data-act="steam-save">Enregistrer</button></div>`}
        <span class="err" id="steam-err"></span>
      </div>

      <div class="box">
        <h3>Epic Games ${a.epic ? `<span class="ok">· ${esc(a.epic)}</span>` : ''}</h3>
        <span class="muted">Temps de jeu Epic et succès débloqués.</span>
        ${a.epic ? `<div class="row2"><span class="ok">Connecté.</span><button class="btn2" data-act="epic-off">Se déconnecter</button></div>` : `
          <ol>
            <li><button class="btn2" data-act="epic-login">Ouvrir la connexion Epic</button> : connecte-toi dans ton navigateur.</li>
            <li>La page affiche un texte : copie la valeur de <b>authorizationCode</b> (ou tout le texte).</li>
            <li>Colle-la ici puis valide (le code expire vite).</li>
          </ol>
          <label for="epic-code">Code Epic</label>
          <div class="row2"><input id="epic-code" type="password" autocomplete="off" spellcheck="false" placeholder="authorizationCode" style="flex:1">
            <button class="btn2 pri" data-act="epic-save">Valider</button></div>`}
        <span class="err" id="epic-err"></span>
      </div>
      <div class="box">
        <h3>Fond d'écran de la bibliothèque</h3>
        <div class="fseg glass" role="radiogroup" aria-label="Type de fond" style="align-self:flex-start">
          ${[['auto', 'Automatique'], ['file', 'Image de mon PC'], ['game', "Bannière d'un jeu"]].map(([k, l]) => `<button role="radio" data-act="wp-mode" data-v="${k}" aria-pressed="${P.wp === k}" aria-checked="${P.wp === k}">${l}</button>`).join('')}
        </div>
        ${P.wp === 'auto' ? "<span class=\"muted\">L'ambiance suit ton dernier jeu et la couleur de la collection choisie.</span>" : ''}
        ${P.wp === 'file' ? `<div class="row2"><label class="btn2" for="wp-file" style="display:flex;align-items:center;cursor:pointer">Choisir une image…</label>
          <input id="wp-file" type="file" accept="image/*" class="sr"><span class="muted">${wpData ? 'Image enregistrée' : 'Aucune image'}</span>
          ${wpData ? '<button class="btn2" data-act="wp-clear">Retirer</button>' : ''}</div>` : ''}
        ${P.wp === 'game' ? `<label for="wp-game">Jeu</label><select id="wp-game" class="sel">
          <option value="">Choisis un jeu…</option>
          ${S.games.filter((x) => x.hero).sort((x, y) => x.name.localeCompare(y.name, 'fr')).map((x) => `<option value="${esc(x.id)}" ${x.id === P.wpGame ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>` : ''}
        ${P.wp !== 'auto' ? `<label for="wp-blur">Flou : <span id="wp-blur-v">${P.wpBlur}</span> px</label><input id="wp-blur" class="range" type="range" min="0" max="40" value="${P.wpBlur}">
          <label for="wp-dim">Assombrir : <span id="wp-dim-v">${P.wpDim}</span> %</label><input id="wp-dim" class="range" type="range" min="0" max="85" value="${P.wpDim}">` : ''}
        <span class="err" id="wp-err"></span>
      </div>
      <span class="muted" style="font-size:12px">Les clés et jetons sont stockés dans le Gestionnaire d'identification de Windows, jamais dans un fichier.</span>
    </div></div>`;
}

// ---------- navigation ----------

function render() {
  document.body.classList.toggle('home', S.view === 'home');
  $('#home').hidden = S.view !== 'home';
  $('#game').hidden = S.view !== 'game';
  renderSources();
  if (S.view === 'home') renderHome(); else renderGame();
  renderFree();
  renderModal();
}
function select(id) {
  if (S.view === 'home') S.homeY = window.scrollY;
  S.sel = id; S.view = 'game'; S.openNews = 0; S.menu = null; S.achF = 'all';
  const g = cur();
  S.tab = 'ach';
  render();
  window.scrollTo({ top: 0 });
  ensureNews(g); ensureAch(g);
}
function goHome() {
  S.view = 'home'; S.menu = null;
  render();
  window.scrollTo({ top: S.homeY });
}

async function refresh(force = false) {
  S.busy = true; $('#refresh-btn').classList.add('spin'); if (S.view === 'home') renderHome();
  try { await invoke('refresh', { force }); } catch (e) { toast('Erreur : ' + e); }
  S.busy = false; $('#refresh-btn').classList.remove('spin'); if (S.view === 'home') renderHome();
  invoke('sync_achievements').catch(() => {});
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

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  const inMenu = e.target.closest('.menu');
  if (!el) { if (S.menu && !inMenu) { S.menu = null; render(); } return; }
  const v = el.dataset.v; const g = cur();
  switch (el.dataset.act) {
    case 'sel': if (e.target.closest('[data-act="play-id"]')) return; select(el.dataset.id); return;
    case 'play-id': e.stopPropagation(); launch(S.games.find((x) => x.id === el.dataset.id), el); return;
    case 'play': launch(g, el); return;
    case 'home': goHome(); return;
    case 'folder': if (g) invoke('open_folder', { id: g.id }).catch((err) => toast(String(err))); break;
    case 'url': invoke('open_url', { url: v }).catch((err) => toast(String(err))); break;
    case 'menu': S.menu = S.menu === el.dataset.menu ? null : el.dataset.menu;
      if (S.menu === 'free' && S.free === null) invoke('free_games').then((f) => { S.free = f; renderFree(); }).catch(() => { S.free = []; renderFree(); });
      render(); return;
    case 'tab': S.tab = v; S.menu = null; renderGame(); $('#panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (v === 'memo') setTimeout(() => $('#memo-ta')?.focus(), 350); return;
    case 'achf': S.achF = v; renderGame(); return;
    case 'reach': S.menu = null; ensureAch(g, true); renderGame(); return;
    case 'news': S.openNews = S.openNews === +v ? -1 : +v; renderGame(); return;
    case 'quick': { const ta = $('#memo-ta'); ta.value = (ta.value.trimEnd() ? ta.value.trimEnd() + '\n' : '') + v + ' : '; ta.focus(); $('#memo-state').textContent = 'Non enregistré'; return; }
    case 'save-memo': saveMemo(); return;
    case 'src': S.src = v; S.col = 'Tout'; S.limit = 120; if (S.view !== 'home') goHome(); else render(); return;
    case 'col': S.col = v; S.limit = 120; renderHome(); return;
    case 'gocol': S.col = v; S.limit = 120; S.view = 'home'; render(); $('#lib')?.scrollIntoView({ behavior: 'smooth' }); return;
    case 'sort': S.sort = v; S.menu = null; renderHome(); return;
    case 'more': S.limit += 120; renderHome(); return;
    case 'soft': S.showSoft = !S.showSoft; renderHome(); return;
    case 'refresh': refresh(); return;
    case 'rescan': S.menu = null; refresh(true); toast('Mise à jour des infos…'); return;
    case 'settings': S.modal = true; S.menu = null; await loadAccounts(); renderModal(); return;
    case 'close-modal': if (e.target === el || el.tagName === 'BUTTON') { S.modal = false; renderModal(); } return;
    case 'steam-save': {
      const key = $('#steam-key').value.trim(); $('#steam-err').textContent = 'Vérification…';
      try { await invoke('set_steam_key', { key }); await loadAccounts(); renderModal(); toast('Steam relié'); S.ach = {}; refresh(); }
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
    case 'wp-mode': P.wp = v; savePrefs(); renderModal(); if (S.view === 'home') renderHome(); return;
    case 'wp-clear': await invoke('set_wallpaper', { dataUrl: '' }); wpData = null; renderModal(); if (S.view === 'home') renderHome(); return;
    case 'epic-off': await invoke('epic_disconnect'); await loadAccounts(); renderModal(); return;
  }
  if (S.menu) { S.menu = null; render(); }
});

$('#q').addEventListener('input', (e) => { S.q = e.target.value; S.limit = 120; if (S.view !== 'home') { S.view = 'home'; render(); } else renderHome(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Escape') {
    if (S.modal) { S.modal = false; renderModal(); } else if (S.menu) { S.menu = null; render(); } else if (S.view === 'game') goHome();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'memo-ta') saveMemo();
});
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'wp-blur' || id === 'wp-dim') {
    P[id === 'wp-blur' ? 'wpBlur' : 'wpDim'] = +e.target.value; savePrefs();
    $(`#${id}-v`).textContent = e.target.value;
    if (S.view === 'home') renderHome();
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'wp-game') { P.wpGame = e.target.value; savePrefs(); if (S.view === 'home') renderHome(); }
  if (e.target.id === 'wp-file' && e.target.files[0]) {
    const f = e.target.files[0];
    const url = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });
    try { await invoke('set_wallpaper', { dataUrl: url }); wpData = url; renderModal(); if (S.view === 'home') renderHome(); toast("Fond d'écran enregistré"); }
    catch (err) { $('#wp-err').textContent = String(err); }
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'memo-ta') $('#memo-state').textContent = 'Non enregistré · Ctrl+Entrée pour enregistrer'; });

// ---------- boot ----------

let pending = false;
function onLibrary(list) {
  S.games = list;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; if (S.view === 'home') { renderSources(); renderHome(); } else renderSources(); });
}

(async () => {
  const [lib, memos, achsum] = await Promise.all([invoke('get_cached'), invoke('get_memos'), invoke('get_achsum')]);
  S.memos = memos; S.achsum = achsum; S.games = lib;
  try { wpData = await invoke('get_wallpaper'); } catch { /* none */ }
  render();
  await listen('library', (e) => onLibrary(e.payload));
  await listen('achsum', (e) => { S.achsum = e.payload; if (S.view === 'home') onLibrary(S.games); });
  loadAccounts();
  refresh();
  invoke('free_games').then((f) => { S.free = f; renderFree(); }).catch(() => {});
})();
