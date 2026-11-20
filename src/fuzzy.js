// Fuzzy matching for the search box and the Ctrl+K palette: accents and case ignored, initials
// ("bg3" → Baldur's Gate 3), any word order, typos tolerated. Pure functions, no DOM.

const MARKS = /[̀-ͯ]/g;
const fold = (s) => String(s ?? '').normalize('NFD').replace(MARKS, '').toLowerCase();
/** "Baldur's Gate 3: Édition" -> "baldurs gate 3 edition" */
export const norm = (s) => fold(s).replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const initials = (w) => w.map((x) => (/^\d+$/.test(x) ? x : x[0])).join('');

/** Precomputed form of a name: built once per game, then each keystroke only scores. */
export function prep(name) {
  const n = norm(name);
  const w = n ? n.split(' ') : [];
  const ini = initials(w);
  const roman = w.map((x) => ROMAN[x] || x);
  return { n, c: w.join(''), w, ini, ini2: initials(roman), c2: roman.join('') };
}

/** Prepared query: normalise once per keystroke, not once per game. */
export function query(q) {
  const n = norm(q);
  return { n, c: n.replace(/ /g, ''), w: n ? n.split(' ') : [] };
}

/**
 * Smallest optimal-string-alignment distance between `a` and a prefix of `b` whose length is
 * within `max` of a's (one DP, every prefix read from the last row). Stops early above `max`.
 */
let R0 = new Int32Array(64), R1 = new Int32Array(64), R2 = new Int32Array(64);
function prefixDist(a, b, max) {
  const n = Math.min(b.length, a.length + max);
  if (n < a.length - max) return max + 1;
  if (n + 1 > R0.length) { R0 = new Int32Array(n + 1); R1 = new Int32Array(n + 1); R2 = new Int32Array(n + 1); }
  let p2 = R2, p = R0, r = R1;
  for (let j = 0; j <= n; j++) p[j] = j;
  for (let i = 1; i <= a.length; i++) {
    r[0] = i;
    let best = i;
    for (let j = 1; j <= n; j++) {
      let v = Math.min(p[j] + 1, r[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && p2[j - 2] + 1 < v) v = p2[j - 2] + 1;
      r[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    const t = p2; p2 = p; p = r; r = t;
  }
  let m = max + 1;
  for (let j = Math.max(0, a.length - max); j <= n; j++) if (p[j] < m) m = p[j];
  return m;
}

/** Characters of q in order inside s; tighter and earlier matches score higher. 0 = no match. */
function subseq(q, s) {
  let j = 0, first = -1, last = -1, runs = 0, prev = -2;
  for (let i = 0; i < s.length && j < q.length; i++) {
    if (s[i] === q[j]) {
      if (first < 0) first = i;
      if (i !== prev + 1) runs++;
      prev = last = i; j++;
    }
  }
  if (j < q.length) return 0;
  const span = last - first + 1;
  if (span > q.length * 3) return 0; // scattered letters: noise
  return 400 - (span - q.length) * 8 - runs * 12 - first * 2;
}

/**
 * Relevance of a prepared name `e` for the raw query `q` (0 = no match). Rough bands:
 * 1000 exact, 900 prefix, 850 initials, 800 every word is a prefix, 700 substring,
 * ≤ 400 letters in order, 250 one or two typos.
 */
export function score(q, e) {
  const Q = typeof q === 'string' ? query(q) : q;
  const { n: qn, c: qc, w: qw } = Q;
  if (!qn || !e.n) return 0;
  if (e.n === qn) return 1000;
  if (e.n.startsWith(qn) || e.c.startsWith(qc)) return 900 - Math.min(50, e.c.length - qc.length);
  if (qc.length >= 2 && !qn.includes(' ')) {
    if (e.ini === qc || e.ini2 === qc) return 880;
    if (e.ini.startsWith(qc) || e.ini2.startsWith(qc)) return 850;
  }
  if (qw.every((x) => e.w.some((w) => w.startsWith(x)))) return 800 - qw.length;
  if (e.c.includes(qc) || e.c2.includes(qc)) return 700 - e.c.indexOf(qc);
  if (qc.length >= 2) {
    const s = subseq(qc, e.c);
    if (s > 0) return Math.max(260, s);
  }
  if (qc.length >= 3) {
    const max = qc.length >= 7 ? 2 : 1;
    // against the start of the name or of a word, a little shorter or longer than the query
    const near = (c) => (c[0] === qc[0] || c[1] === qc[1]) && prefixDist(qc, c, max) <= max;
    if (near(e.c) || e.w.some(near)) return 250;
  }
  return 0;
}

/**
 * Inline completion: when `typed` is the start of `name` (ignoring case and accents), returns the
 * full name with the typed part kept as typed, else null.
 */
export function completion(typed, name) {
  if (!typed || !name) return null;
  const t = fold(typed);
  let i = 0, j = 0;
  while (i < t.length && j < name.length) {
    const c = fold(name[j]);
    if (!c) { j++; continue; } // lone combining mark
    if (c !== t.slice(i, i + c.length)) return null;
    i += c.length; j++;
  }
  return i === t.length && j < name.length ? typed + name.slice(j) : null;
}
