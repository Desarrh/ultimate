// Test d'interface de bout en bout : pilote la vraie fenêtre WebView2 par le protocole DevTools.
// Lancer l'appli avec WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, puis : node tests/ui.mjs [dossier captures]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = process.argv[2] || 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
let step = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => !p.url().startsWith('devtools')) ;
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} @ ${(e.stack || '').split(String.fromCharCode(10))[1]?.trim() || ''}`));
let missing404 = 0;
page.on('console', (m) => { if (m.type() !== 'error') return; if (/status of 404/.test(m.text())) { missing404++; return; } errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => { if (!r.url().includes('fonts.g')) errors.push(`request failed: ${r.url().slice(0, 140)} (${r.failure()?.errorText})`); });

async function check(name, fn) {
  step++;
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    results.push({ ok: false, name, detail: String(e.message || e) });
    console.log(`✘ ${name} — ${e.message || e}`);
  }
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png` }).catch(() => {});
}
const click = async (sel) => {
  const ok = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; }, sel);
  if (!ok) throw new Error(`introuvable : ${sel}`);
  await sleep(350);
};
// click without scrolling the element into view (to measure page jumps)
const clickKeep = async (sel) => { const ok = await page.evaluate((x) => { const el = document.querySelector(x); if (!el) return false; el.click(); return true; }, sel); if (!ok) throw new Error(`introuvable : ${sel}`); };
const count = (sel) => page.$$eval(sel, (l) => l.length);
const text = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const assert = (c, m) => { if (!c) throw new Error(m); };

// The test clicks real buttons: snapshot the user's data and display settings, restore them at the end.
const snapshot = await page.evaluate(async () => ({ user: await window.__TAURI_INTERNALS__.invoke('get_user'), prefs: localStorage.getItem('prefs') }));
async function restore() {
  await page.evaluate(async (snap) => {
    await window.__TAURI_INTERNALS__.invoke('set_user', { u: snap.user });
    if (snap.prefs !== null) localStorage.setItem('prefs', snap.prefs);
    location.reload();
  }, snapshot).catch(() => {});
  await sleep(3000);
}
process.on('uncaughtException', async (e) => { console.error(e); await restore(); process.exit(1); });

// wait for the background refresh to finish
for (let i = 0; i < 120; i++) { if (!(await page.$('#refresh-btn.spin'))) break; await sleep(1000); }
await sleep(1500);

await check('Accueil affiché', async () => {
  const n = await count('#vgrid .cov');
  assert(n > 0, 'aucune jaquette');
  return `${await text('.home-head .sub')} · ${n} jaquettes dans le DOM`;
});

await check('Grille virtualisée', async () => {
  const shown = await count('#vgrid .cov');
  const total = parseInt((await text('#lib .sec-head .muted')).replace(/\D/g, ''), 10);
  assert(total > shown, `${shown} rendues pour ${total} jeux : pas virtualisée ?`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  const last = await page.$$eval('#vgrid .cov .nm', (l) => l.map((x) => x.textContent));
  assert(last.length > 0, 'rien en bas de liste');
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
  return `${shown} rendues sur ${total}, bas de liste OK`;
});

await check('Images des jaquettes chargées', async () => {
  await sleep(2500);
  const r = await page.$$eval('#vgrid .cov img', (l) => ({ n: l.length, broken: l.filter((i) => i.complete && i.naturalWidth === 0).length, w: Math.max(...l.map((i) => i.naturalWidth)) }));
  assert(r.broken === 0, `${r.broken} image(s) cassée(s)`);
  assert(r.w <= 440, `vignette trop grande : ${r.w}px`);
  return `${r.n} images, largeur max ${r.w}px (redimensionnées)`;
});

await check('Doublons visibles dans « Tout »', async () => {
  const names = await page.evaluate(async () => {
    const out = [];
    const host = document.querySelector('#vgrid');
    for (let y = host.getBoundingClientRect().top + scrollY; y < host.getBoundingClientRect().top + scrollY + host.offsetHeight; y += innerHeight * 0.8) {
      window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); await new Promise((r) => setTimeout(r, 30));
      document.querySelectorAll('#vgrid .cov').forEach((c) => out.push(c.dataset.id + '|' + c.querySelector('.nm').textContent));
    }
    window.scrollTo(0, 0);
    return [...new Set(out)];
  });
  const byName = {};
  for (const x of names) { const [id, n] = x.split('|'); const k = n.toLowerCase().replace(/[^a-z0-9]/g, ''); (byName[k] ||= []).push(id); }
  const dups = Object.entries(byName).filter(([, v]) => v.length > 1 && new Set(v.map((i) => i.split(':')[0])).size === 1);
  const extras = names.filter((x) => /\b(playtest|beta|demo|soundtrack|ost|dlc|hd pack|texture pack|dedicated server)\b/i.test(x.split('|')[1]));
  assert(!dups.length, `doublons même plateforme : ${dups.map((d) => d[0]).join(', ')}`);
  assert(!extras.length, `extras dans « Tout » : ${extras.map((x) => x.split('|')[1]).join(', ')}`);
  return `${names.length} jeux distincts, aucun doublon ni extra`;
});

await check('Collections cliquables', async () => {
  const cols = await page.$$eval('.col', (l) => l.map((c) => c.dataset.v));
  const out = [];
  for (const c of cols.slice(0, 8)) {
    await click(`.col[data-v="${c}"]`);
    const pressed = await page.$eval(`.col[data-v="${c}"]`, (e) => e.getAttribute('aria-pressed'));
    assert(pressed === 'true', `${c} pas sélectionnée`);
    out.push(`${c}: ${(await text('#lib .sec-head .muted')).split(' ')[0]}`);
  }
  await click('.col[data-v="Tout"]');
  return `${cols.length} collections (${out.join(', ')})`;
});

await check('Collections Apps et Démos & tests', async () => {
  const has = await page.$$eval('.col', (l) => l.map((c) => c.querySelector('b').textContent));
  assert(has.includes('Apps'), 'pas de collection Apps');
  await click('.col[data-v="Logiciel"]');
  const apps = await page.$$eval('#vgrid .cov .nm', (l) => l.map((x) => x.textContent));
  assert(apps.some((n) => /godot|aseprite|blender/i.test(n)), 'Godot/Aseprite absents des Apps');
  let demos = '—';
  if (has.some((x) => /Démos|Demos/.test(x))) { await click('.col[data-v="Démo"]'); demos = await text('#lib .sec-head .muted'); }
  await click('.col[data-v="Tout"]');
  return `Apps : ${apps.length} (${apps.slice(0, 4).join(', ')}) · Démos & tests : ${demos}`;
});

await check('Aucun saut de page à l\'ouverture des menus', async () => {
  const pos = () => page.evaluate(() => ({ y: Math.round(scrollY), lib: Math.round(document.querySelector('#lib').getBoundingClientRect().top) }));
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#lib').offsetTop - 120));
  await sleep(400);
  const before = await pos();
  await clickKeep('[data-menu="sort"]'); await sleep(400);
  const open = await pos();
  assert(await page.$('#sort-menu .menu'), 'menu de tri non ouvert');
  await page.mouse.click(5, 300); await sleep(400);
  const closed = await pos();
  await clickKeep('[data-menu="free"]'); await sleep(300); const free = await pos(); await page.keyboard.press('Escape'); await sleep(300);
  await clickKeep('[data-menu="sort"]'); await sleep(300);
  await clickKeep('#sort-menu [data-v="hours"]'); await sleep(500);
  const sorted = await pos();
  const moved = [open, closed, free, sorted].map((p) => Math.abs(p.y - before.y) + Math.abs(p.lib - before.lib));
  assert(moved.every((d) => d <= 2), `la page a bougé : ${moved.join(' / ')} px (ouvrir / fermer / cadeau / trier)`);
  await clickKeep('#sort-menu [data-v="recent"]'); await sleep(300); await clickKeep('[data-menu="sort"]'); await sleep(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  return `0 px de décalage (ouvrir, fermer, autre menu, trier)`;
});

await check('Menu de tri + chaque tri', async () => {
  await click('[data-menu="sort"]');
  assert(await page.$('#sort-menu .menu'), 'menu de tri non ouvert');
  for (const k of ['hours', 'az', 'pct', 'size', 'recent']) {
    await click(`#sort-menu [data-act="sort"][data-v="${k}"]`);
    const on = await page.$eval(`#sort-menu [data-v="${k}"]`, (e) => e.getAttribute('aria-checked'));
    assert(on === 'true', `${k} non coché`);
  }
  await click('#sort-menu [data-act="sortdir"][data-v="asc"]');
  const asc = await page.$eval('#sort-menu [data-act="sortdir"][data-v="asc"]', (e) => e.getAttribute('aria-checked'));
  await click('#sort-menu [data-act="sortdir"][data-v="desc"]');
  assert(asc === 'true', 'ordre croissant non coché');
  await click('[data-menu="sort"]');
  const first = await page.$$eval('#vgrid .cov .nm', (l) => l.slice(0, 3).map((x) => x.textContent));
  return `OK, en tête (récents) : ${first.join(', ')}`;
});

await check('Recherche', async () => {
  await page.click('#q'); await page.keyboard.type('valheim'); await sleep(500);
  const n = await page.$$eval('#vgrid .cov .nm', (l) => l.map((x) => x.textContent));
  assert(n.some((x) => /valheim/i.test(x)), 'Valheim introuvable');
  await page.click('#q', { clickCount: 3 }); await page.keyboard.press('Backspace'); await sleep(500);
  return `« valheim » → ${n.length} résultat(s)`;
});

await check('Menu jeux gratuits', async () => {
  await click('[data-menu="free"]');
  const t = await page.$eval('#free-menu', (e) => e.innerText);
  assert(/EPIC/.test(t) && /STEAM/.test(t) && /GOG/.test(t), 'sections manquantes');
  const items = await count('#free-menu .free-item');
  await page.keyboard.press('Escape'); await sleep(300);
  return `${items} offre(s) listée(s)`;
});

await check('Menu amis', async () => {
  await click('[data-menu="friends"]');
  await sleep(2500);
  const n = await count('#friends-menu .fitem');
  const t = await page.$eval('#friends-menu', (e) => e.innerText.slice(0, 80));
  await page.keyboard.press('Escape'); await sleep(300);
  return n ? `${n} ami(s)` : t.replace(/\s+/g, ' ');
});

await check('Page Statistiques', async () => {
  await click('#stats-btn');
  assert(await page.$('#stats .hbar'), 'pas de top jeux');
  const k = await page.$$eval('#stats .kpis .v', (l) => l.map((x) => x.textContent.trim()));
  await click('#back');
  assert(await page.$('#vgrid'), 'retour accueil raté');
  return k.join(' · ');
});

await check('Paramètres (ouverture, interrupteurs, fermeture)', async () => {
  await click('[data-act="settings"]');
  assert(await page.$('.dialog'), 'fenêtre absente');
  const toggles = await count('.dialog .tgl');
  const boxes = await page.$$eval('.dialog h3', (l) => l.map((x) => x.textContent.trim().split(' ')[0]));
  await click('[data-act="wp-mode"][data-v="game"]');
  assert(await page.$('#wp-game'), 'choix du jeu absent');
  await click('[data-act="wp-mode"][data-v="auto"]');
  await page.keyboard.press('Escape'); await sleep(300);
  assert(!(await page.$('.dialog')), 'Échap ne ferme pas');
  return `${toggles} interrupteurs · sections : ${boxes.join(', ')}`;
});

await check('Nouvelle collection (création puis suppression)', async () => {
  await click('[data-act="newcol"]');
  await page.type('#col-name', 'Test auto');
  await click('[data-act="createcol"]');
  assert(await page.$('.col[data-v="c:Test auto"]'), 'collection non créée');
  await click('.col[data-v="c:Test auto"]');
  await click('[data-act="delcol"]');
  assert(!(await page.$('.col[data-v="c:Test auto"]')), 'collection non supprimée');
  return 'OK';
});

await check('Fiche jeu', async () => {
  await click('#vgrid .cov');
  await sleep(1200);
  assert(await page.$('#game .play'), 'pas de bouton Jouer');
  const name = await text('#game .gname');
  const bg = await page.$eval('#bg-img', (i) => i.naturalWidth);
  return `${name} · fond ${bg}px (écran ${await page.evaluate(() => innerWidth * devicePixelRatio)}px)`;
});

await check('Onglets de la fiche', async () => {
  const out = [];
  for (const t of ['ach', 'news', 'shots', 'memo']) {
    await click(`.tab[data-v="${t}"]`);
    await sleep(t === 'ach' ? 2500 : 900);
    const sel = await page.$eval('.tab[aria-selected="true"]', (e) => e.dataset.v);
    assert(sel === t, `onglet ${t} non sélectionné`);
    out.push(`${t}: ${(await page.$eval('#panel .panel', (e) => e.innerText.split('\n').slice(1, 3).join(' '))).slice(0, 50)}`);
  }
  return out.join(' | ');
});

await check('Menu options + sous-menus', async () => {
  await click('[data-menu="opts"]');
  assert(await page.$('.menu [data-act="fav"]'), 'menu options absent');
  await click('[data-act="sub"][data-v="cols"]');
  assert(await page.$('.submenu'), 'sous-menu collections absent');
  await click('[data-act="sub"][data-v="manage"]');
  const items = await page.$$eval('.submenu .mi', (l) => l.map((x) => x.textContent.trim()));
  assert(items.length >= 2, 'sous-menu Gérer vide');
  await page.keyboard.press('Escape'); await sleep(300);
  return `Gérer : ${items.join(', ')}`;
});

await check('Favori (ajout / retrait)', async () => {
  await click('#game .btns [data-act="fav"]'); await sleep(300);
  const on = await page.$eval('#game .btns [data-act="fav"]', (e) => e.getAttribute('aria-label'));
  await click('#game .btns [data-act="fav"]'); await sleep(300);
  assert(/Retirer|Unfavorite/.test(on), 'favori non appliqué');
  return 'OK';
});

await check('Note façon Letterboxd + coup de cœur', async () => {
  const pt = async () => {
    await page.evaluate(() => document.querySelector('.rate .star[data-v="4"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(700);
    return page.evaluate(() => { const b = document.querySelector('.rate .star[data-v="4"]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width * 0.25, y: r.top + r.height / 2 }; });
  };
  let p;
  for (let i = 0; i < 3 && (await page.$('.rate .rv')); i++) { p = await pt(); await page.mouse.click(p.x, p.y); await sleep(300); }
  p = await pt(); await page.mouse.click(p.x, p.y); await sleep(400);
  const t1 = await text('.rate .rv');
  assert(/3[.,]5/.test(t1), `demi-étoile non prise : ${t1}`);
  const h0 = await page.$eval('.rate .heart', (e) => e.getAttribute('aria-pressed'));
  await click('.rate .heart'); await sleep(300);
  const h = await page.$eval('.rate .heart', (e) => e.getAttribute('aria-pressed'));
  assert(h !== h0, 'cœur non basculé');
  await click('.tab[data-v="review"]'); await sleep(400);
  assert(await page.$('#review-ta'), 'onglet avis absent');
  p = await pt(); await page.mouse.click(p.x, p.y); await sleep(300);
  await click('.rate .heart'); await sleep(300);
  assert(!(await page.$('.rate .rv')), 'note non effacée');
  return 'demi-étoile, cœur, avis et effacement OK';
});

await check('Durée HowLongToBeat', async () => {
  for (let i = 0; i < 20 && !(await page.$('.hl')); i++) await sleep(500);
  const t = await page.$eval('.gside', (e) => e.innerText.replace(/\s+/g, ' '));
  assert(/POUR FINIR|TIME TO BEAT/.test(t), 'carte HowLongToBeat absente');
  return t.slice(0, 120);
});

await check('Succès : 9 puis « Afficher plus »', async () => {
  await click('.tab[data-v="ach"]'); await sleep(1200);
  const n0 = await count('.achs .ach');
  const btn = await page.$('[data-act="achmore"]');
  if (btn) { await click('[data-act="achmore"]'); await sleep(400); }
  const n1 = await count('.achs .ach');
  assert(n0 <= 9, `${n0} succès affichés d'emblée`);
  return btn ? `${n0} → ${n1} après « Show more »` : `${n0} (pas assez pour le bouton)`;
});

await check('Retour à l\'accueil (Échap)', async () => {
  await page.keyboard.press('Escape'); await sleep(600);
  assert(await page.$('#vgrid'), 'pas revenu à l\'accueil');
  return 'OK';
});

await check('Apparence : accent fixe et taille des jaquettes', async () => {
  const cols = async () => page.evaluate(() => getComputedStyle(document.querySelector('#vgrid .grid')).gridTemplateColumns.split(' ').length);
  await click('[data-act="settings"]');
  const orig = await page.$eval('[data-act="size"][aria-pressed="true"]', (e) => e.dataset.v);
  await click('[data-act="size"][data-v="M"]');
  await page.keyboard.press('Escape'); await sleep(500);
  const c0 = await cols();
  await click('[data-act="settings"]');
  await click('[data-act="acc-mode"][data-v="fixed"]');
  await click('[data-act="acc-col"][data-v="#3EE6A8"]');
  const a = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--a').trim());
  await click('[data-act="size"][data-v="L"]');
  await page.keyboard.press('Escape'); await sleep(500);
  const c1 = await cols();
  await click('[data-act="settings"]');
  await click(`[data-act="size"][data-v="${orig}"]`);
  await click('[data-act="acc-mode"][data-v="dyn"]');
  await page.keyboard.press('Escape'); await sleep(400);
  assert(a.toUpperCase() === '#3EE6A8', `accent fixe non appliqué : ${a}`);
  assert(c1 < c0, `grandes jaquettes : ${c0} → ${c1} colonnes`);
  return `accent ${a} · colonnes ${c0} → ${c1} (grandes)`;
});

await check('Bouton « Ajouter un jeu »', async () => {
  assert(await page.$('[data-act="addgame"]'), 'bouton absent');
  return 'présent (la fenêtre de choix de fichier n\'est pas testable automatiquement)';
});

await check('Chiffres cliquables : temps de jeu et succès, ↑/↓', async () => {
  const names = () => page.$$eval('#vgrid .cov .nm', (l) => l.slice(0, 3).map((x) => x.textContent));
  await click('[data-act="kpi"][data-v="hours"]'); await sleep(900);
  const desc = await names();
  await click('[data-act="kpi"][data-v="hours"]'); await sleep(900);
  const asc = await names();
  assert(desc[0] !== asc[0], `ordre identique : ${desc[0]}`);
  await click('[data-act="kpi"][data-v="achn"]'); await sleep(900);
  const ach = await names();
  const sortTxt = await text('[data-menu="sort"]');
  await click('[data-menu="sort"]'); await click('#sort-menu [data-v="recent"]'); await click('[data-menu="sort"]'); await sleep(400);
  return `temps ↓ ${desc[0]} · ↑ ${asc[0]} · succès ↓ ${ach[0]} · bouton « ${sortTxt} »`;
});

await check('Vue Liste façon Steam (tri par succès)', async () => {
  await click('[data-act="kpi"][data-v="achn"]'); await sleep(2500);
  const rows = await count('#vgrid .lrow');
  const icons = await count('#vgrid .licons img');
  const first = await page.$eval('#vgrid .lrow .nm', (e) => e.textContent);
  await click('[data-act="layout"][data-v="grid"]'); await sleep(500);
  const grid = await count('#vgrid .cov');
  await click('[data-act="layout"][data-v="list"]'); await sleep(300);
  await click('[data-menu="sort"]'); await click('#sort-menu [data-v="recent"]'); await click('[data-menu="sort"]');
  await click('[data-act="layout"][data-v="grid"]'); await sleep(400);
  assert(rows > 0, 'pas de lignes en vue liste'); assert(grid > 0, 'retour grille raté');
  return `${rows} lignes (1re : ${first}), ${icons} icônes de succès, bascule grille OK`;
});

await check('Panthéon (100 %)', async () => {
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await click('[data-act="trophy"]'); await sleep(1500);
  const n = await count('.hof-card');
  const title = await text('.hof-head h1');
  const dates = await page.$$eval('.hof-date', (l) => l.filter((x) => x.textContent.trim()).length);
  assert(n > 0, 'aucun jeu à 100 %');
  await page.keyboard.press('Escape'); await sleep(500);
  assert(await page.$('#vgrid'), 'retour raté');
  return `${title} · ${n} jeux · ${dates} dates`;
});

await check('Recherche : seuls les jeux restent', async () => {
  await page.focus('#q'); await sleep(400);
  const hidden = await page.evaluate(() => ['.cols-wrap', '.home-head', '.resume'].every((s) => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).display === 'none'));
  const top = await page.evaluate(() => Math.round(document.querySelector('#vgrid').getBoundingClientRect().top));
  await page.evaluate(() => document.activeElement.blur()); await sleep(500);
  const back = await page.evaluate(() => getComputedStyle(document.querySelector('.cols-wrap')).display !== 'none');
  assert(hidden, 'sections encore visibles'); assert(back, 'sections non revenues');
  return `grille à ${top}px du haut, sections revenues au flou`;
});

await check('Jaquettes non installées sans nom par-dessus', async () => {
  await click('.col[data-v="Tout"]'); await sleep(500);
  const r = await page.evaluate(() => {
    const c = document.querySelector('#vgrid .cov.notinst'); if (!c) return null;
    const img = c.querySelector('.art img'); const st = getComputedStyle(img);
    return { op: st.opacity, filter: st.filter, nm: getComputedStyle(c.querySelector('.meta .nm')).color };
  });
  assert(r, 'aucun jeu non installé visible');
  assert(+r.op === 1, `image encore transparente (${r.op}) : le nom en dessous transparaît`);
  return `opacité 1, ${r.filter}, nom ${r.nm}`;
});

await check('Retour depuis une fiche : jaquettes déjà affichées', async () => {
  await click('#vgrid .cov'); await sleep(1500);
  await page.keyboard.press('Escape');
  const r = await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => {
    const imgs = [...document.querySelectorAll('#vgrid .cov img')];
    ok({ n: imgs.length, ready: imgs.filter((i) => i.complete && i.naturalWidth > 0).length });
  })));
  assert(r.n > 0 && r.ready === r.n, `${r.ready}/${r.n} jaquettes prêtes à la 1re image`);
  return `${r.ready}/${r.n} prêtes dès la première image`;
});

await check('Mémoire', async () => {
  const m = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  return m ? `tas JS ${m} Mo` : 'n/d';
});

await restore();
const after = await page.evaluate(async () => ({ user: await window.__TAURI_INTERNALS__.invoke('get_user'), prefs: localStorage.getItem('prefs') }));
// compare ignoring key order (the Rust side stores ratings in a hash map)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = canon(after.user.ratings) === canon(snapshot.user.ratings) && canon(after.user.favorites) === canon(snapshot.user.favorites)
  && canon(after.user.collections) === canon(snapshot.user.collections) && canon(JSON.parse(after.prefs || 'null')) === canon(JSON.parse(snapshot.prefs || 'null'));
results.push({ ok: same, name: "Données de l'utilisateur remises comme avant", detail: same ? 'notes, favoris, collections, affichage identiques' : 'DIFFÉRENCE' });
console.log(`${same ? '✔' : '✘'} Données de l'utilisateur remises comme avant`);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} vérifications OK`);
const uniq = [...new Set(errors)];
console.log(`${missing404} image(s) absente(s) côté serveur (404, masquées)`);
console.log(`${uniq.length} erreur(s) console/réseau${uniq.length ? ':\n  ' + uniq.slice(0, 25).join('\n  ') : ''}`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, errors: uniq }, null, 2));
await browser.disconnect();
process.exit(ok === results.length && !uniq.length ? 0 : 1);
