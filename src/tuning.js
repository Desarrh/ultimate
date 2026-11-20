// Recommended settings for this PC, NVIDIA-app style but explained. Pure functions, no DOM, no network:
// a per-game sheet (src/tuning/*.json) when there is one, generic rules otherwise.
// Internal FPS estimates only rank the options; they are never shown (no promised numbers).

import cyberpunk from './tuning/cyberpunk2077.json' with { type: 'json' };

export const SHEETS = [cyberpunk];

/** Sheet for a library game (Steam / GOG id, then name). */
export function sheetFor(g) {
  const name = String(g?.name || '').toLowerCase();
  return SHEETS.find((s) => (s.match.steam && g?.steamAppid === s.match.steam) || (g?.id === `gog:${s.match.gog}`) || s.match.names.some((n) => name.startsWith(n))) || null;
}

// Relative raster performance, RTX 3070 Ti = 100 (rough, from public GPU hierarchies).
const GPUS = [
  ['rtx 5090', 260], ['rtx 5080', 190], ['rtx 5070 ti', 170], ['rtx 5070', 135], ['rtx 5060 ti', 100], ['rtx 5060', 88],
  ['rtx 4090', 225], ['rtx 4080 super', 180], ['rtx 4080', 175], ['rtx 4070 ti super', 155], ['rtx 4070 ti', 145], ['rtx 4070 super', 130], ['rtx 4070', 115], ['rtx 4060 ti', 90], ['rtx 4060', 75],
  ['rtx 3090 ti', 125], ['rtx 3090', 115], ['rtx 3080 ti', 112], ['rtx 3080', 105], ['rtx 3070 ti', 100], ['rtx 3070', 93], ['rtx 3060 ti', 82], ['rtx 3060', 64], ['rtx 3050', 45],
  ['rtx 2080 ti', 88], ['rtx 2080 super', 78], ['rtx 2080', 74], ['rtx 2070 super', 70], ['rtx 2070', 62], ['rtx 2060 super', 58], ['rtx 2060', 50],
  ['gtx 1660', 40], ['gtx 1080 ti', 70], ['gtx 1080', 55], ['gtx 1070', 45], ['gtx 1060', 32],
  ['rx 9070 xt', 160], ['rx 9070', 140], ['rx 7900 xtx', 185], ['rx 7900 xt', 160], ['rx 7900 gre', 135], ['rx 7800 xt', 125], ['rx 7700 xt', 105], ['rx 7600', 70],
  ['rx 6950 xt', 135], ['rx 6900 xt', 128], ['rx 6800 xt', 120], ['rx 6800', 105], ['rx 6750 xt', 90], ['rx 6700 xt', 85], ['rx 6650 xt', 72], ['rx 6600 xt', 68], ['rx 6600', 60],
  ['arc b580', 75], ['arc a770', 70], ['arc a750', 62],
];

/** What the tuning needs to know about the graphics card. */
export function gpuInfo(hw) {
  const n = String(hw?.gpu || '').toLowerCase();
  const hit = GPUS.find(([k]) => n.includes(k));
  const vram = (hw?.vramMb || 0) / 1024;
  const score = hit ? hit[1] : Math.max(25, Math.min(120, vram * 9)); // unknown card: guess from its memory
  const nvidia = n.includes('nvidia') || n.includes('rtx') || n.includes('gtx');
  const rtx = n.includes('rtx');
  const gen = rtx ? +((n.match(/rtx\s*(\d)0\d\d/) || [])[1] || 0) : 0; // 2, 3, 4, 5
  return { name: hw?.gpu || '?', score, known: !!hit, vram, nvidia, dlss: rtx, dlssFg: rtx && gen >= 4, rt: rtx || /rx (6|7|9)\d{3}|arc/.test(n) };
}

// CPU headroom, i9-9900K = 100 (only matters for very high FPS targets).
function cpuScore(name) {
  const n = String(name || '').toLowerCase();
  if (/9800x3d|9950x3d|7800x3d|7950x3d|285k|265k/.test(n)) return 165;
  if (/14900|13900|14700|13700|9950x|9900x|7950x|7900x/.test(n)) return 145;
  if (/5800x3d|5950x|5900x|12900|12700|14600|13600|9700x|9600x|7700x|7600x/.test(n)) return 125;
  if (/5800x|5600x|12600|12400|11900|11700|10900|10700/.test(n)) return 110;
  if (/9900k|9900ks|9700k|10600|3900x|3700x|3600/.test(n)) return 100;
  return 90;
}

const MP = (w, h) => (w * h) / 1e6;
// DLSS / FSR / XeSS presets: share of the output resolution rendered per axis
export const SCALES = [
  { id: 'native', dlss: 'DLAA', fsr: 'Off', s: 1, fr: 'natif (DLAA)', en: 'native (DLAA)' },
  { id: 'quality', dlss: 'Quality', fsr: 'Quality', s: 0.667, fr: 'Qualité', en: 'Quality' },
  { id: 'balanced', dlss: 'Balanced', fsr: 'Balanced', s: 0.58, fr: 'Équilibré', en: 'Balanced' },
  { id: 'performance', dlss: 'Performance', fsr: 'Performance', s: 0.5, fr: 'Performance', en: 'Performance' },
  { id: 'ultra', dlss: 'Ultra Performance', fsr: 'Ultra Performance', s: 0.333, fr: 'Ultra Performance', en: 'Ultra Performance' },
];
/** Slider: 0 = Performance … 4 = Quality. Quality level aimed at, and lowest upscaling allowed. */
export const SLIDER = [
  { b: 0.12, minScale: 0.333, maxScale: 0.5, fr: 'Performance', en: 'Performance' },
  { b: 0.3, minScale: 0.5, maxScale: 0.58, fr: 'Fluidité', en: 'Smooth' },
  { b: 0.5, minScale: 0.5, maxScale: 0.667, fr: 'Équilibré', en: 'Balanced' },
  { b: 0.72, minScale: 0.58, maxScale: 1, fr: 'Beau', en: 'Pretty' },
  { b: 0.92, minScale: 0.667, maxScale: 1, fr: 'Qualité', en: 'Quality' },
];

/** Internal order of magnitude only. */
function fpsAt(perf, gpu, mpOut, scale, b, rt) {
  const pixels = Math.max(0.3, mpOut * scale * scale);
  return perf.fpsLow * (gpu.score / perf.refGpu) * Math.pow(perf.refMp / pixels, 0.85) * (1 - perf.qualityCost * b) * (rt ? 1 - perf.rtCost : 1);
}

/** "Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz" -> "Intel Core i9-9900K" */
export const cpuShort = (n) => String(n || '?').replace(/\((R|TM|tm|r)\)/g, '').replace(/\s*(CPU\s*)?@.*$/, '').replace(/\s+\d+-Core Processor$/i, '').replace(/\s+/g, ' ').trim();
const fmtRes = (hw) => `${hw.width} × ${hw.height}`;

/**
 * Recommendation for one game. `lang` 'fr' | 'en'. Returns the chosen upscaling, a verdict about the
 * FPS target and one row per setting: { key, label, current, rec, reason, src }.
 */
export function recommend({ hw, sheet, current = {}, slider = 2, target = 120, lang = 'fr' }) {
  const L = (o) => (o ? o[lang] ?? o.fr : '');
  const t = (fr, en) => (lang === 'en' ? en : fr);
  const gpu = gpuInfo(hw);
  const perf = sheet?.perf || { refGpu: 100, refMp: 3.6864, fpsLow: 160, qualityCost: 0.45, cpuCap: 140, rtCost: 0.45 };
  const mpOut = MP(hw.width || 1920, hw.height || 1080);
  const hz = hw.hz || 60;
  const goalAsked = Math.min(target, hz);
  const cpuCap = perf.cpuCap * cpuScore(hw.cpu) / 100;
  const cpuLimited = goalAsked > cpuCap * 0.95;
  const goal = Math.min(goalAsked, cpuCap * 0.95);
  const sl = SLIDER[Math.max(0, Math.min(4, slider))];
  const upscaler = gpu.dlss ? 'DLSS' : 'FSR';

  // highest quality level first, then the least upscaling that still reaches the goal
  let pick = null;
  for (let b = sl.b; b >= -0.001 && !pick; b -= 0.04) {
    for (const sc of SCALES) {
      if (sc.s > sl.maxScale + 1e-6) continue;
      if (sc.s < sl.minScale - 1e-6) break;
      const f = fpsAt(perf, gpu, mpOut, sc.s, Math.max(0, b), false);
      if (f >= goal) { pick = { b: Math.max(0, b), sc, f }; break; }
    }
  }
  const reached = !!pick;
  if (!pick) {
    const sc = SCALES[SCALES.length - 1];
    pick = { b: 0, sc, f: fpsAt(perf, gpu, mpOut, sc.s, 0, false) };
  }
  const margin = pick.f / goal;
  const verdict = !reached ? 'out' : margin < 1.12 ? 'tight' : 'ok';
  const b = pick.b;

  const rows = [];
  const add = (key, label, rec, reason, src = []) => rows.push({ key, label, current: current[key], rec, reason, src });

  // upscaling, the biggest lever
  const scLabel = pick.sc[lang] ?? pick.sc.fr;
  if (sheet) {
    add('ResolutionScaling', t('Mise à l\'échelle', 'Resolution scaling'), upscaler === 'DLSS' ? 'DLSS' : 'FSR3',
      upscaler === 'DLSS' ? t('ta carte gère DLSS : plus net que FSR à résolution interne égale', 'your card supports DLSS: sharper than FSR at the same internal resolution')
        : t('pas de DLSS sur cette carte : FSR', 'no DLSS on this card: FSR'));
    add(upscaler === 'DLSS' ? 'DLSS' : 'FSR3', upscaler, upscaler === 'DLSS' ? pick.sc.dlss : pick.sc.fsr,
      pick.sc.id === 'native' ? t(`ta carte a de la marge en ${fmtRes(hw)} : rendu natif avec l'anticrénelage DLAA`, `plenty of headroom at ${fmtRes(hw)}: native rendering with DLAA`)
        : mpOut > 6 && pick.sc.s <= 0.5 ? t(`en ${fmtRes(hw)}, le mode ${scLabel} part d'une image interne encore très définie : le meilleur levier pour ta cible`, `at ${fmtRes(hw)}, ${scLabel} still starts from a very detailed internal image: the best lever for your target`)
          : t(`le meilleur levier pour atteindre ta cible sans trop sacrifier le reste`, `the best lever to reach your target without sacrificing the rest`));
    add('FrameGeneration', t('Génération d\'images', 'Frame generation'), gpu.dlssFg && goalAsked >= 120 ? 'On' : 'Off',
      gpu.dlssFg ? (goalAsked >= 120 ? t('ta carte la gère : double les images affichées, un peu plus de latence', 'your card supports it: doubles displayed frames, slightly more latency') : t('inutile pour cette cible', 'not needed for this target'))
        : t('la génération d\'images DLSS demande une RTX 40 ou plus récente', 'DLSS frame generation needs an RTX 40 series or newer'));
  }

  for (const s of sheet?.settings || []) {
    const label = L(s.label);
    let i = 0;
    s.min.forEach((m, k) => { if (b >= m - 1e-6) i = k; });
    let reason = i < s.values.length - 1 ? L(s.up) : L(s.top);
    if (s.rule === 'textures') {
      const rtOn = false;
      const budget = gpu.vram * 0.9;
      const need = (k) => s.vram[k] + 0.2 * mpOut + (rtOn ? 1.5 : 0);
      i = s.values.length - 1;
      while (i > 0 && need(i) > budget) i--;
      const top = s.values.length - 1;
      reason = i === top
        ? t(`${s.values[top]} tient dans tes ${Math.round(gpu.vram)} Go de VRAM en ${fmtRes(hw)} ; ${L(s.top)}`, `${s.values[top]} fits in your ${Math.round(gpu.vram)} GB of VRAM at ${fmtRes(hw)}; ${L(s.top)}`)
        : t(`${s.values[i + 1]} dépasse tes ${Math.round(gpu.vram)} Go de VRAM en ${fmtRes(hw)} (saccades quand la mémoire déborde)`, `${s.values[i + 1]} exceeds your ${Math.round(gpu.vram)} GB of VRAM at ${fmtRes(hw)} (stutter when memory overflows)`);
    } else if (s.rule === 'crowd') {
      if (cpuLimited || goalAsked >= cpuCap * 0.8) {
        i = Math.min(i, 1);
        reason = t(`à ${goalAsked} images/s, c'est le processeur (${cpuShort(hw.cpu)}) qui limite en ville : moins de foule, moins de calcul`, `at ${goalAsked} FPS your CPU (${cpuShort(hw.cpu)}) is the limit in the city: fewer people, less work`);
      } else reason = i === s.values.length - 1 ? L(s.top) : t('foule coûteuse pour le processeur', 'crowds are CPU-heavy');
    } else if (s.rule === 'rt' || s.rule === 'pt') {
      const pt = s.rule === 'pt';
      const ok = gpu.rt && goalAsked <= 60 && slider >= 3 && gpu.score >= (pt ? 170 : 100) && gpu.vram >= (pt ? 12 : 10);
      i = ok ? 1 : 0;
      reason = ok ? t('ta carte et ta cible le permettent ; active la reconstruction de rayons (DLSS RR)', 'your card and target allow it; enable DLSS Ray Reconstruction')
        : !gpu.rt ? t('pas d\'accélération ray tracing sur cette carte', 'no ray tracing acceleration on this card')
          : goalAsked > 60 ? t(`coûte environ la moitié des images : incompatible avec ${goalAsked} images/s`, `costs around half the frames: not compatible with ${goalAsked} FPS`)
            : gpu.vram < (pt ? 12 : 10) ? t(`${Math.round(gpu.vram)} Go de VRAM ne suffisent pas en ${fmtRes(hw)} avec ${pt ? 'le path tracing' : 'le ray tracing'}`, `${Math.round(gpu.vram)} GB of VRAM is not enough at ${fmtRes(hw)} with ${pt ? 'path tracing' : 'ray tracing'}`)
              : t('trop lourd pour cette carte à cette résolution', 'too heavy for this card at this resolution');
    } else if (s.rule === 'ssr' && current.RayTracedReflections === true) {
      reason += t(' (sans effet si les réflexions RT sont actives)', ' (no effect when RT reflections are on)');
    }
    if (!reason) reason = i === s.values.length - 1 ? t('coût faible pour ce niveau de qualité', 'low cost at this quality level') : t('baissé pour tenir ta cible', 'lowered to hold your target');
    add(s.key, label, s.values[i], reason, s.src || []);
  }

  // display: cap and latency
  if (sheet) {
    const cap = goalAsked >= hz ? Math.max(30, hz - 3) : goalAsked;
    add('VSync', 'VSync', 'UI-Settings-Video-QualitySetting-Off', t('avec G-Sync / FreeSync, la limite d\'images suffit sans ajouter de latence', 'with G-Sync / FreeSync, the frame cap is enough without extra latency'));
    add('MaximumFPS_Value', t('Limite d\'images/s', 'Frame rate cap'), cap,
      goalAsked >= hz ? t(`${hz} Hz - 3 : reste dans la plage G-Sync, sans à-coups`, `${hz} Hz - 3: stays inside the G-Sync range, no tearing`) : t(`ta cible : des images régulières plutôt qu'un plafond qui varie`, `your target: steady frames rather than a fluctuating ceiling`));
    if (gpu.nvidia) add('ReflexMode', 'NVIDIA Reflex', 'Enabled', t('moins de latence, sans coût', 'lower latency, no cost'));
  }

  return { gpu, goal: goalAsked, cpuLimited, verdict, scale: pick.sc, upscaler, b, rows, generic: sheet ? [] : generic({ hw, gpu, goal: goalAsked, cpuLimited, mpOut, slider, lang, scLabel, upscaler }) };
}

/** Advice for games without a sheet. */
function generic({ hw, gpu, goal, cpuLimited, mpOut, slider, lang, scLabel, upscaler }) {
  const t = (fr, en) => (lang === 'en' ? en : fr);
  const out = [];
  out.push({ k: t('Mise à l\'échelle', 'Upscaling'), v: `${upscaler} ${scLabel}`, why: gpu.dlss ? t('DLSS si le jeu le propose, sinon FSR ou XeSS ; c\'est le levier le plus efficace', 'DLSS if the game offers it, else FSR or XeSS; the most effective lever') : t('FSR ou XeSS si le jeu le propose', 'FSR or XeSS if the game offers it') });
  out.push({ k: t('Textures', 'Textures'), v: gpu.vram >= 12 ? t('Ultra', 'Ultra') : gpu.vram >= 8 ? t('Haut', 'High') : t('Moyen', 'Medium'), why: t(`souvent presque gratuites en images/s, tant qu'elles tiennent dans tes ${Math.round(gpu.vram)} Go de VRAM${mpOut > 6 ? ` (${hw.width} × ${hw.height} en consomme plus)` : ''}`, `usually almost free in FPS, as long as they fit your ${Math.round(gpu.vram)} GB of VRAM${mpOut > 6 ? ` (${hw.width} × ${hw.height} uses more)` : ''}`) });
  out.push({ k: t('À baisser en premier', 'Lower first'), v: t('ombres, volumétrie, réflexions', 'shadows, volumetrics, reflections'), why: t('les réglages les plus coûteux dans la plupart des jeux, pour une différence souvent faible', 'the most expensive settings in most games, often for a small visual difference') });
  out.push({ k: t('Ray tracing', 'Ray tracing'), v: gpu.rt && goal <= 60 && gpu.vram >= 10 && slider >= 3 ? t('selon le jeu', 'depends on the game') : 'Off', why: goal > 60 ? t(`coûte souvent la moitié des images : incompatible avec ${goal} images/s`, `often costs half the frames: not compatible with ${goal} FPS`) : t('seulement si la carte a de la marge et assez de VRAM', 'only with GPU headroom and enough VRAM') });
  out.push({ k: t('Limite d\'images/s', 'Frame cap'), v: goal >= (hw.hz || 60) ? `${(hw.hz || 60) - 3}` : `${goal}`, why: t('VSync coupé, G-Sync / FreeSync actif, limite juste sous la fréquence de l\'écran', 'VSync off, G-Sync / FreeSync on, cap just below the refresh rate') });
  if (gpu.nvidia) out.push({ k: 'NVIDIA Reflex', v: t('Activé', 'On'), why: t('si le jeu le propose : moins de latence, sans coût', 'if the game offers it: lower latency, no cost') });
  if (cpuLimited || goal >= 165) out.push({ k: t('Processeur', 'CPU'), v: cpuShort(hw.cpu), why: t(`à ${goal} images/s, beaucoup de jeux sont limités par le processeur : baisser la densité de foule, la distance de vue ou la physique aide plus que les graphismes`, `at ${goal} FPS many games are CPU-limited: lowering crowd density, view distance or physics helps more than graphics`) });
  return out;
}
