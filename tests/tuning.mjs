// Tests of src/tuning.js (recommended settings): `node tests/tuning.mjs`
import assert from 'node:assert/strict';
import { recommend, sheetFor, gpuInfo, cpuShort } from '../src/tuning.js';

const pc = { gpu: 'NVIDIA GeForce RTX 3070 Ti', vramMb: 8192, cpu: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz', ramMb: 49087, width: 5120, height: 1440, hz: 240 };
const cp = sheetFor({ name: 'Cyberpunk 2077', steamAppid: 1091500 });
assert.ok(cp, 'fiche Cyberpunk');
assert.equal(sheetFor({ name: 'Hollow Knight', steamAppid: 367520 }), null);
const g = gpuInfo(pc);
assert.equal(cpuShort(pc.cpu), 'Intel Core i9-9900K');
assert.equal(g.score, 100); assert.ok(g.dlss && !g.dlssFg && g.rt);

const rec = (slider, target) => recommend({ hw: pc, sheet: cp, slider, target, lang: 'fr' });
const val = (r, k) => r.rows.find((x) => x.key === k)?.rec;
for (const s of [0, 2, 4]) for (const t of [60, 120, 240]) {
  const r = rec(s, t);
  assert.equal(val(r, 'ResolutionScaling'), 'DLSS');
  assert.equal(val(r, 'FrameGeneration'), 'Off'); // RTX 30: no DLSS frame generation
  assert.equal(val(r, 'TextureQuality'), 'High'); // 8 GB is enough at 5120 x 1440 without RT
  assert.notEqual(val(r, 'VolumetricCloudsQuality'), 'Ultra'); // Medium looks the same
  assert.notEqual(val(r, 'ScreenSpaceReflectionsQuality'), 'Insane');
  assert.equal(val(r, 'RayTracedPathTracing'), false);
  assert.ok(r.rows.every((x) => x.reason && x.label), JSON.stringify(r.rows.filter((x) => !x.reason)));
}
assert.equal(val(rec(2, 120), 'RayTracing'), false);
assert.equal(rec(2, 240).cpuLimited, true);
assert.equal(val(rec(2, 240), 'MaximumFPS_Value'), 237);
assert.equal(val(rec(2, 120), 'MaximumFPS_Value'), 120);
// slider: Performance never looks better than Quality
const order = (r, k) => cp.settings.find((s) => s.key === k).values.indexOf(val(r, k));
for (const k of ['AmbientOcclusion', 'VolumetricFogResolution', 'LocalShadowsQuality']) assert.ok(order(rec(0, 60), k) <= order(rec(4, 60), k), k);
// textures go down with less memory
assert.notEqual(val(recommend({ hw: { ...pc, gpu: 'NVIDIA GeForce RTX 3060', vramMb: 6144 }, sheet: cp, slider: 2, target: 60 }), 'TextureQuality'), 'High');
// generic rules for a game without a sheet
const gen = recommend({ hw: pc, sheet: null, slider: 2, target: 120, lang: 'en' });
assert.ok(gen.generic.length >= 5 && gen.rows.length === 0);
// speed: instant on the game page
const t0 = performance.now(); for (let i = 0; i < 200; i++) rec(i % 5, [60, 120, 240][i % 3]);
const ms = (performance.now() - t0) / 200;
assert.ok(ms < 2, `${ms} ms`);
const r = rec(2, 120);
console.log(`3070 Ti, 5120x1440, Équilibré, 120 images/s : DLSS ${r.scale.dlss}, verdict ${r.verdict}, ${ms.toFixed(3)} ms`);
for (const x of r.rows) console.log(`  ${x.label} = ${x.rec}  — ${x.reason}`);
console.log('tuning: ok');
