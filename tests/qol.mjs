// Vérifie recherche floue, palette Ctrl+K, garde-fou dev et mode jeu sur l'appli lancée
// (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, et `--hidden` pour ne rien afficher à
// l'écran : le test pilote la page par DevTools, sans souris ni clavier système).
// Prérequis : appli lancée avec ULTIMATE_TEST_SANDBOX=<dossier> (sinon le test s'arrête) et, sur un profil de test, un jeu ajouté « Zork Fakegame QA » (petit exe qui dort, dans le bac à sable,
// admin désactivé) et `vigiePath` vers le faux Vigie.exe (tests/fakes, construit par qa-start.sh) qui journalise ses appels dans calls.log :
// Bac à sable conseillé : C:\Dev\Launcher\.qa (hors AppData, donc hors virtualisation MSIX ; ignoré par git).
// Une appli de test fraîche par passage (relancer qa-start.sh) : les caches de la page faussent un 2e passage.
// node tests/qol.mjs <dossier captures> <calls.log>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = process.argv[2] || 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => !p.url().startsWith('devtools'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(`CSP : ${m.text().slice(0, 200)}`); });
let fails = 0;
async function check(name, fn) {
  try { const d = await fn(); console.log(`✔ ${name}${d ? ' — ' + d : ''}`); }
  catch (e) { fails++; console.log(`✘ ${name} — ${e.message || e}`); }
  await page.screenshot({ path: `${OUT}/qol-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png` }).catch(() => {});
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// Safety lock: the app must run with ULTIMATE_TEST_SANDBOX (it then refuses to launch anything,
// or call any Vigie, outside that folder). Without it, stop before touching anything.
await page.waitForFunction(() => document.readyState === 'complete' && window.__TAURI_INTERNALS__?.invoke, { timeout: 15000 }).catch(() => {});
const sandbox = await page.evaluate(async () => { try { return await window.__TAURI_INTERNALS__.invoke('test_mode'); } catch { return null; } });
if (!sandbox) { console.error('✘ Appli lancée sans ULTIMATE_TEST_SANDBOX : test annulé, aucun jeu ne doit être lancé.'); await browser.disconnect(); process.exit(2); }
console.log(`bac à sable : ${sandbox}`);
// leftover fake game from a previous run: its session must end first (game mode counts sessions)
{
  const { execSync } = await import('node:child_process');
  const ps = "@(Get-Process Game -EA 0 | Where-Object { $_.Path -like '*fakegame*' } | Stop-Process -Force -PassThru).Count";
  const left = execSync(`powershell -NoProfile -Command "${ps}"`).toString().trim();
  if (left !== '0') { console.log('faux jeu précédent fermé, attente de la fin de sa session…'); await new Promise((r) => setTimeout(r, 20000)); }
}
const CALLS = process.argv[3];
const calls = () => (CALLS && fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8') : '');
const FAKE = 'Zork Fakegame QA';
await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('refresh', {}));
await sleep(1500);

await check('bac à sable : un vrai jeu est refusé', async () => {
  const r = await page.evaluate(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const g = (await inv('get_cached')).find((x) => x.installed && x.source !== 'pc');
    if (!g) return 'aucun jeu réel installé';
    try { await inv('launch', { id: g.id }); return `LANCÉ : ${g.id}`; } catch (e) { return String(e); }
  });
  assert(!r.startsWith('LANCÉ'), r);
  return r;
});

await check('recherche floue < 5 ms et complétion en ligne', async () => {
  await page.click('#q', { clickCount: 3 }); await page.keyboard.press('Backspace');
  await page.keyboard.type('zork fa', { delay: 50 }); await sleep(300);
  const st = await page.evaluate(() => { const q = document.querySelector('#q'); return { v: q.value, s: q.selectionStart, e: q.selectionEnd }; });
  assert(st.v.toLowerCase() === FAKE.toLowerCase() && st.e > st.s, `complétion : ${JSON.stringify(st)}`);
  const ms = await page.evaluate(() => {
    const q = document.querySelector('#q'); const t0 = performance.now();
    for (let i = 0; i < 20; i++) { q.value = 'bg3'; q.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '3' })); }
    return (performance.now() - t0) / 20;
  });
  assert(ms < 5, `${ms.toFixed(2)} ms par frappe`);
  return `"${st.v}" (sélection ${st.s}-${st.e}), ${ms.toFixed(2)} ms par frappe (filtre + complétion)`;
});

await check('initiales, fautes et accents', async () => {
  const top = async (q) => {
    await page.click('#q', { clickCount: 3 }); await page.keyboard.press('Backspace');
    await page.keyboard.type(q, { delay: 20 }); await sleep(250);
    return page.evaluate(() => document.querySelector('#home .lib [data-act="sel"] .nm')?.textContent || '');
  };
  const r = { zfq: await top('zfq'), fakgeme: await top('fakgeme'), zórk: await top('zórk'), 'qa zork': await top('qa zork') };
  assert(Object.values(r).every((x) => x === FAKE), JSON.stringify(r));
  return JSON.stringify(r);
});

await check('palette Ctrl+K : commande et raccourcis', async () => {
  await page.click('#q', { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.keyboard.press('Escape');
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  assert(await page.$('.pal'), 'palette absente');
  const kb = await page.$$eval('#pal-list kbd', (l) => l.map((e) => e.textContent));
  assert(kb.includes('F5'), JSON.stringify(kb));
  await page.keyboard.type('stat', { delay: 30 }); await sleep(150);
  const rows = await page.$$eval('#pal-list .pal-row b', (l) => l.map((e) => e.textContent));
  await page.keyboard.press('Enter'); await sleep(400);
  assert(await page.evaluate(() => !document.querySelector('#stats').hidden), `stats non ouvertes (${rows.join(' | ')})`);
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(150);
  assert(!(await page.$('.pal')), 'Échap ne ferme pas');
  return `${rows[0]} · raccourcis ${kb.join(' ')}`;
});

await check('palette : jeu → garde-fou 2 s → lancement → mode jeu', async () => {
  fs.writeFileSync(CALLS, '');
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(250);
  await page.keyboard.type('zfq', { delay: 30 }); await sleep(600); // lets the dev state prefetch finish
  const first = await page.$eval('#pal-list .pal-row b', (e) => e.textContent);
  assert(first === FAKE, `1er résultat : ${first}`);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.devguard', { timeout: 1500 });
  const txt = await page.$eval('.devguard', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  await page.waitForSelector('.devguard', { hidden: true, timeout: 3500 });
  const waited = Date.now() - t0;
  const t1 = Date.now();
  while (!/--avant-jeu/.test(calls()) && Date.now() - t1 < 8000) await sleep(200);
  await page.waitForFunction(() => document.querySelector('#toast.on') && /Vigie/.test(document.querySelector('#toast').textContent), { timeout: 8000 });
  const toastTxt = await page.$eval('#toast', (e) => e.textContent);
  const c = calls();
  assert(/--avant-jeu/.test(c) && !/--couper-dev/.test(c), `appels Vigie : ${c || '(aucun)'}`); // the dev state may come from the cache
  return `popup « ${txt} », fermée après ${waited} ms ; toast « ${toastTxt} »`;
});

await check('fin du jeu → --apres-jeu', async () => {
  await sleep(6000); // the session is seen (5 s probe)
  const { execSync } = await import('node:child_process');
  execSync('powershell -NoProfile -Command "Get-Process Game | Where-Object { $_.Path -like \'*fakegame*\' } | Stop-Process -Force"');
  const t0 = Date.now();
  while (!/--apres-jeu/.test(calls()) && Date.now() - t0 < 25000) await sleep(500);
  assert(/--apres-jeu/.test(calls()), calls());
  return `vu ${((Date.now() - t0) / 1000).toFixed(0)} s après la fermeture`;
});

await check('garde-fou : « Tout couper »', async () => {
  fs.writeFileSync(CALLS, '');
  await page.click('#q', { clickCount: 3 }); await page.keyboard.press('Backspace');
  await page.keyboard.type('zork', { delay: 20 }); await sleep(300);
  // like hovering Play: the dev state is fetched ahead (without it, a slow Vigie just means no popup)
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'play'; b.hidden = true; document.body.append(b); b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); b.remove(); });
  await sleep(800);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.devguard [data-dg="kill"]', { timeout: 1500 });
  await page.click('.devguard [data-dg="kill"]');
  const t0 = Date.now();
  while (!(/--couper-dev/.test(calls()) && /--avant-jeu/.test(calls())) && Date.now() - t0 < 8000) await sleep(300);
  const c = calls();
  assert(/--couper-dev --seulement 1:111,wsl/.test(c) && /--avant-jeu/.test(c), c);
  await sleep(6000);
  const { execSync } = await import('node:child_process');
  execSync('powershell -NoProfile -Command "Get-Process Game | Where-Object { $_.Path -like \'*fakegame*\' } | Stop-Process -Force"');
  const t1 = Date.now(); // leave no session behind: wait for its --apres-jeu
  while (!/--apres-jeu/.test(calls()) && Date.now() - t1 < 25000) await sleep(500);
  return 'couper-dev puis jeu lancé, session refermée';
});

await check('réglages conseillés : appliquer puis restaurer (copie, jamais le vrai fichier)', async () => {
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const real = path.join(process.env.LOCALAPPDATA, 'CD Projekt Red', 'Cyberpunk 2077', 'UserSettings.json');
  if (!fs.existsSync(real)) return 'Cyberpunk absent : ignoré';
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const realBefore = hash(real);
  const dir = path.join(sandbox, 'cp2077');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, 'UserSettings.json');
  fs.copyFileSync(real, copy); // read-only use of the real file
  const orig = hash(copy);
  const sel = (id) => page.evaluate((id) => { const b = document.createElement('button'); b.dataset.act = 'sel'; b.dataset.id = id; document.body.append(b); b.click(); b.remove(); }, id);
  await sel('steam:1091500'); await sleep(600);
  await page.evaluate(() => document.querySelector('[data-act="tab"][data-v="tune"]').click());
  await page.waitForSelector('[data-act="tune-apply"]', { timeout: 5000 });
  const label = await page.$eval('[data-act="tune-apply"]', (e) => e.textContent);
  await page.$eval('#toast', (e) => { e.textContent = ''; });
  await page.$eval('[data-act="tune-apply"]', (e) => e.click());
  await page.waitForFunction(() => /appli/i.test(document.querySelector('#toast').textContent), { timeout: 5000 });
  await page.waitForSelector('[data-act="tune-restore"]', { timeout: 5000 });
  const baks = fs.readdirSync(dir).filter((f) => f === 'UserSettings.json.avant-ultimate.bak');
  assert(baks.length === 1 && hash(path.join(dir, baks[0])) === orig, `sauvegarde : ${baks}`);
  assert(hash(copy) !== orig, 'copie inchangée');
  const toastTxt = await page.$eval('#toast', (e) => e.textContent);
  const after = await page.$eval('[data-act="tune-apply"]', (e) => e.textContent);
  await page.$eval('[data-act="tune-restore"]', (e) => e.click()); await sleep(1500);
  assert(hash(copy) === orig, 'restauration incomplète');
  assert(hash(real) === realBefore, 'LE VRAI FICHIER A CHANGÉ');
  fs.rmSync(dir, { recursive: true, force: true });
  return `« ${label} » → « ${toastTxt.trim()} », bouton ensuite « ${after} » ; restauré à l'octet près, vrai fichier intact`;
});

await check('mémoire manquante (Vigie --memoire-jeu) sous Jouer', async () => {
  // no log reset: Cyberpunk's answer may come from the 20 s cache filled by the previous check
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'sel'; b.dataset.id = 'pc:qafake'; document.body.append(b); b.click(); b.remove(); });
  await page.waitForFunction(() => { const m = document.querySelector('#memhint'); return m && !m.hidden && m.textContent.trim(); }, { timeout: 5000 });
  const txt = await page.$eval('#memhint', (e) => e.textContent.trim());
  assert(/1[.,]4/.test(txt) && /--memoire-jeu .*Game\.exe/i.test(calls()), `${txt} | ${calls()}`);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'sel'; b.dataset.id = 'steam:1091500'; document.body.append(b); b.click(); b.remove(); });
  const t0 = Date.now();
  while (!/--memoire-jeu .*Cyberpunk 2077\s*$/m.test(calls()) && Date.now() - t0 < 5000) await sleep(200);
  assert(/--memoire-jeu .*Cyberpunk 2077\s*$/m.test(calls()), `dossier non passé : ${calls()}`);
  await page.waitForFunction(() => { const m = document.querySelector('#memhint'); return m && !m.hidden && m.textContent.trim(); }, { timeout: 5000 });
  return `${txt} (exe) ; Cyberpunk : dossier d'installation passé à Vigie`;
});

console.log(errors.length ? `Erreurs JS : ${errors.join(' / ')}` : 'Aucune erreur JS');
await browser.disconnect();
process.exit(fails || errors.length ? 1 : 0);
