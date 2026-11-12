// Cold start: how many times is the library page rebuilt in the first seconds?
// Start the app fresh with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, then: node tests/coldstart.mjs [seconds]
import puppeteer from 'puppeteer-core';

const secs = +(process.argv[2] || 25);
let b;
for (let i = 0; i < 40 && !b; i++) {
  try { b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null }); } catch { await new Promise((r) => setTimeout(r, 250)); }
}
const p = (await b.pages()).find((x) => !x.url().startsWith('devtools'));
await p.evaluate(() => {
  window.__rebuilds = [];
  const t0 = performance.now();
  new MutationObserver((ms) => {
    // a rebuild = the cards under the cursor are replaced
    if (ms.some((m) => [...m.removedNodes].some((n) => n.nodeType === 1 && (n.matches?.('.home-head, .cols-wrap, .grid') || n.querySelector?.('.col, .cov'))))) {
      window.__rebuilds.push(Math.round(performance.now() - t0));
    }
  }).observe(document.querySelector('#home'), { childList: true, subtree: true });
});
await new Promise((r) => setTimeout(r, secs * 1000));
const r = await p.evaluate(() => window.__rebuilds);
const perSec = {};
r.forEach((t) => { const s = Math.floor(t / 1000); perSec[s] = (perSec[s] || 0) + 1; });
const worst = Math.max(0, ...Object.values(perSec));
console.log(`${r.length} reconstructions en ${secs} s · pire seconde : ${worst}`);
await b.disconnect();
process.exit(worst > 1 ? 1 : 0);
