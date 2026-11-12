// Prépare une version publiable : build signé + latest.json pour la mise à jour automatique.
// Usage : node scripts/release.mjs <proprietaire/depot> ["notes de version"]
// Clé privée : %USERPROFILE%\.tauri\ultimate.key (jamais dans le dépôt).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = process.argv[2];
if (!repo || !repo.includes('/')) { console.error('Usage : node scripts/release.mjs proprietaire/depot ["notes"]'); process.exit(1); }
const notes = process.argv[3] || '';
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const v = conf.version;
const keyPath = path.join(os.homedir(), '.tauri', 'ultimate.key');
const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(keyPath, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' };
execSync('npx tauri build', { stdio: 'inherit', env });

const dir = 'src-tauri/target/release/bundle/nsis';
const setup = fs.readdirSync(dir).find((f) => f.endsWith(`_${v}_x64-setup.exe`));
if (!setup) throw new Error(`installeur ${v} introuvable dans ${dir}`);
const sig = fs.readFileSync(path.join(dir, `${setup}.sig`), 'utf8').trim();
const latest = {
  version: v,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: sig, url: `https://github.com/${repo}/releases/download/v${v}/${encodeURIComponent(setup)}` } },
};
fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(latest, null, 2));
console.log(`\nVersion ${v} prête. À publier sur https://github.com/${repo}/releases/new (tag v${v}) :`);
console.log(`  - ${path.join(dir, setup)}`);
console.log(`  - ${path.join(dir, 'latest.json')}`);
console.log(`Source à mettre dans Ultimate > Paramètres : https://github.com/${repo}/releases/latest/download/latest.json`);
