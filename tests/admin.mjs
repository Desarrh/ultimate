// Run-as-admin decision of the front, against the cases also checked by the Rust test
// (lib.rs admin_decision_matches_the_front): `node tests/admin.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isAdmin } from '../src/admin.js';

const cases = JSON.parse(fs.readFileSync(new URL('./admin-cases.json', import.meta.url), 'utf8'));
for (const c of cases) {
  const over = c.override === null ? {} : { x: c.override };
  assert.equal(isAdmin({ id: 'x', source: c.source, launch: c.launch }, over), c.admin, JSON.stringify(c));
}
console.log(`admin: ok (${cases.length} cas)`);
