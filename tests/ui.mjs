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
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
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
const count = (sel) => page.$$eval(sel, (l) => l.length);
const text = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const assert = (c, m) => { if (!c) throw new Error(m); };

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
  if (has.includes('Démos & tests')) { await click('.col[data-v="Démo"]'); demos = await text('#lib .sec-head .muted'); }
  await click('.col[data-v="Tout"]');
  return `Apps : ${apps.length} (${apps.slice(0, 4).join(', ')}) · Démos & tests : ${demos}`;
});

await check('Menu de tri + chaque tri', async () => {
  for (const k of ['hours', 'az', 'pct', 'size', 'recent']) {
    await click('[data-menu="sort"]');
    assert(await page.$('.menu [data-act="sort"]'), 'menu de tri non ouvert');
    await click(`.menu [data-act="sort"][data-v="${k}"]`);
  }
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
  assert(/Retirer/.test(on), 'favori non appliqué');
  return 'OK';
});

await check('Retour à l\'accueil (Échap)', async () => {
  await page.keyboard.press('Escape'); await sleep(600);
  assert(await page.$('#vgrid'), 'pas revenu à l\'accueil');
  return 'OK';
});

await check('Mémoire', async () => {
  const m = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  return m ? `tas JS ${m} Mo` : 'n/d';
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} vérifications OK`);
const uniq = [...new Set(errors)];
console.log(`${uniq.length} erreur(s) console/réseau${uniq.length ? ':\n  ' + uniq.slice(0, 25).join('\n  ') : ''}`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, errors: uniq }, null, 2));
await browser.disconnect();
process.exit(ok === results.length && !uniq.length ? 0 : 1);
