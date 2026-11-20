// Tests of src/fuzzy.js (pure JS): `node tests/fuzzy.mjs`
import assert from 'node:assert/strict';
import { prep, query, score, completion, norm } from '../src/fuzzy.js';

const names = ["Baldur's Gate 3", 'Elden Ring', 'Hollow Knight', 'The Witcher 3: Wild Hunt', 'Grand Theft Auto V', 'Hadès', 'Pokémon Légendes', 'Celeste', 'Cyberpunk 2077', 'Hollow Knight: Silksong', 'Stardew Valley', 'Red Dead Redemption 2'];
const idx = names.map((n) => ({ n, e: prep(n) }));
const top = (q) => idx.map((x) => ({ n: x.n, s: score(q, x.e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n);

assert.equal(norm("Baldur's Gate 3: Édition"), 'baldurs gate 3 edition');
assert.equal(top('bg3')[0], "Baldur's Gate 3");
assert.equal(top('er')[0], 'Elden Ring');
assert.equal(top('gta5')[0], 'Grand Theft Auto V');
assert.equal(top('hades')[0], 'Hadès');
assert.equal(top('pokemon')[0], 'Pokémon Légendes');
assert.equal(top('legendes')[0], 'Pokémon Légendes');
assert.equal(top('eldne')[0], 'Elden Ring'); // transposition
assert.equal(top('hollow knigt')[0], 'Hollow Knight'); // typo + words
assert.equal(top('knight hollow')[0], 'Hollow Knight'); // word order
assert.equal(top('silk')[0], 'Hollow Knight: Silksong');
assert.equal(top('witcher')[0], 'The Witcher 3: Wild Hunt');
assert.equal(top('cyber')[0], 'Cyberpunk 2077');
assert.equal(top('rdr2')[0], 'Red Dead Redemption 2');
assert.equal(top('stardw')[0], 'Stardew Valley');
assert.equal(top('hollw')[0], 'Hollow Knight'); // missing letter
assert.equal(top('silksnog')[0], 'Hollow Knight: Silksong'); // swapped letters, mid-name word
assert.equal(top('cleste')[0], 'Celeste');
assert.deepEqual(top('zzzz'), []);
assert.ok(!top('xq').length);

assert.equal(completion('eld', 'Elden Ring'), 'elden Ring');
assert.equal(completion('pokem', 'Pokémon Légendes'), 'pokemon Légendes');
assert.equal(completion('poké', 'Pokémon'), 'pokémon');
assert.equal(completion('poke', 'Pokémon'), 'pokemon');
assert.equal(completion('Elden Ring', 'Elden Ring'), null);
assert.equal(completion('ring', 'Elden Ring'), null);

// speed: 2,000 games, one keystroke must stay well under 5 ms
const big = Array.from({ length: 2000 }, (_, i) => prep(`${names[i % names.length]} ${i}`));
for (const q of ['b', 'bg3', 'hollow kn', 'eldne', 'zzzz']) {
  const t0 = performance.now();
  for (let r = 0; r < 20; r++) { const Q = query(q); for (const e of big) score(Q, e); }
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 5, `${q}: ${ms.toFixed(2)} ms`);
  console.log(`  "${q}" sur 2000 jeux : ${ms.toFixed(2)} ms`);
}
console.log('fuzzy: ok');
