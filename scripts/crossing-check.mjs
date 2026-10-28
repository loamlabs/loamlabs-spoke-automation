// REPORT ONLY. Compares the crossing the theme DRAWS in the Studio (getEstimatedCrossPattern in the theme's assets/variant-builder.js) with the crossing the
// backend's REAL spoke-length calculation USES (runCalculationEngine in api/index.js), over a table of spoke counts, positions, brake styles, hub types and
// hub lacing policies. It changes neither side; it prints where they differ.
//   node scripts/crossing-check.mjs      -> out/crossing-check.md (all rows) and a summary on screen
// The theme function is loaded from the same git ref as the geometry drift test (LOAM_THEME_DIR / LOAM_THEME_REF, see tests/helpers/theme-studio.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeSource } from '../tests/helpers/theme-studio.mjs';
import { runCalculationEngine } from '../api/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = themeSource();
if (!src) { console.error('LOAM_THEME_DIR=skip: nothing to compare'); process.exit(1); }
const vb = src.read('assets/variant-builder.js');
const block = (name) => { const i = vb.indexOf(`function ${name}(`); if (i < 0) throw new Error(`${name} not found in the theme`); const end = vb.indexOf('\n}\n', i); return vb.slice(i, end + 3); };
const theme = new Function(`${block('isLacingPossible')}\n${block('getEstimatedCrossPattern')}\nreturn getEstimatedCrossPattern;`)();

const SPOKE_COUNTS = [16, 20, 24, 28, 32, 36, 40];
const POSITIONS = ['Front', 'Rear'];
const BRAKES = ['6-Bolt', 'Rim Brake'];
const HUB_TYPES = ['Straight Pull', 'Classic Flange'];
const CASES = [ // [label, policy, manual]
  ['no policy', '', ''],
  ['Use Manual Override Field, value blank', 'Use Manual Override Field', ''],
  ['Use Manual Override Field, value 0', 'Use Manual Override Field', '0'],
  ['Use Manual Override Field, value 2', 'Use Manual Override Field', '2'],
  ['Use Manual Override Field, value 3', 'Use Manual Override Field', '3'],
  ['Force 2-Cross for 28h Only', 'Force 2-Cross for 28h Only', ''],
  ['Force 3-Cross for 28h Only', 'Force 3-Cross for 28h Only', ''],
  ['Force All as 2-Cross', 'Force All as 2-Cross', '']
];

function backendCross(n, pos, brake, hubType, policy, manual) {
  const p = pos.toLowerCase();
  const recipe = { buildType: pos, specs: { brakeStyle: brake, [p + 'SpokeCount']: n + 'h' }, components: {
    [p + 'Rim']: { variantId: 'R', title: 'Rim', selectedOptions: [] }, [p + 'Hub']: { variantId: 'H', title: 'Hub', selectedOptions: [] },
    [p + 'Spokes']: { variantId: 'S', title: 'Spokes', vendor: 'Sapim', selectedOptions: [] } } };
  const meta = new Map();
  meta.set('R', { rim_erd: '600', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.5', rim_target_tension_kgf: '120', rim_spoke_hole_offset: '0' });
  meta.set('H', { hub_type: hubType, hub_flange_diameter_left: '58', hub_flange_diameter_right: '58', hub_flange_offset_left: '32', hub_flange_offset_right: '22', hub_spoke_hole_diameter: '2.6', hub_sp_offset_spoke_hole_left: '3', hub_sp_offset_spoke_hole_right: '3', hub_lacing_policy: policy || undefined, hub_manual_cross_value: manual || undefined });
  meta.set('S', { spoke_cross_section_area_mm2: '2.3' });
  const log = console.log; console.log = () => {};
  let r; try { r = runCalculationEngine(recipe, meta)[p]; } finally { console.log = log; }
  if (!r || !r.calculationSuccessful) return { error: (r && r.error) || 'no result' };
  return { left: r.crossPattern.left, right: r.crossPattern.right };
}

const rows = [];
for (const hubType of HUB_TYPES) for (const pos of POSITIONS) for (const brake of BRAKES) for (const n of SPOKE_COUNTS) for (const [label, policy, manual] of CASES) {
  const hubProduct = { hub_lacing_policy: policy ? { value: policy } : undefined };
  const hubVariant = { hub_manual_cross_value: manual ? { value: manual } : undefined };
  const t = theme(hubProduct, hubVariant, n, pos, brake);
  const b = backendCross(n, pos, brake, hubType, policy, manual);
  const same = !b.error && Number(b.left) === Number(t) && Number(b.right) === Number(t);
  rows.push({ hubType, pos, brake, n, label, theme: t, backend: b.error ? 'FAILS: ' + b.error.slice(0, 60) : (b.left === b.right ? String(b.left) : `L${b.left}/R${b.right}`), same, failed: !!b.error });
}

// a difference "rule": group rows that differ so the list stays short
const diffs = rows.filter((r) => !r.same);
const groups = new Map();
for (const r of diffs) { const key = `${r.hubType}|${r.label}|${r.brake}|${r.pos === 'Front' || r.brake === 'Rim Brake' ? r.pos : 'any'}`; (groups.get(key) || groups.set(key, []).get(key)).push(r); }
const lines = [];
lines.push(`# Crossing check: theme (${src.origin}) vs backend calculation`, '', `${rows.length} combinations, ${rows.length - diffs.length} agree, ${diffs.length} differ.`, '');
const summarize = (rs) => rs.map((r) => `${r.n}h${r.pos === 'Front' ? ' front' : ' rear'}: theme ${r.theme}, backend ${r.backend}`);
const byCase = new Map(); for (const r of diffs) { const k = `${r.hubType} / ${r.label}`; (byCase.get(k) || byCase.set(k, []).get(k)).push(r); }
lines.push('## Differences by hub type and policy', '');
for (const [k, rs] of byCase) {
  const uniq = [...new Set(summarize(rs.filter((r) => r.brake === '6-Bolt')))];
  const rim = [...new Set(summarize(rs.filter((r) => r.brake === 'Rim Brake' && r.pos === 'Front')))];
  lines.push(`### ${k}: ${rs.length} rows`, uniq.length ? ('- disc: ' + uniq.join('; ')) : '', rim.length ? ('- rim-brake front: ' + rim.join('; ')) : '', '');
}
lines.push('## All rows', '', '| hub type | position | brake | holes | policy | theme draws | backend uses | |', '|---|---|---|---|---|---|---|---|');
for (const r of rows) lines.push(`| ${r.hubType} | ${r.pos} | ${r.brake} | ${r.n} | ${r.label} | ${r.theme} | ${r.backend} | ${r.same ? 'same' : '**DIFFERENT**'} |`);
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'crossing-check.md'), lines.join('\n') + '\n');

// short summary on screen: no policy only, then the policy cases
const noPolicy = rows.filter((r) => r.label === 'no policy' && r.hubType === 'Straight Pull');
console.log(`theme ref: ${src.origin}`);
console.log(`${rows.length} combinations; ${diffs.length} differ (full list: out/crossing-check.md)`);
console.log('\nNo hub policy, straight-pull hub (what most orders hit):');
for (const pos of POSITIONS) for (const brake of BRAKES) console.log(`  ${pos.padEnd(5)} ${brake.padEnd(9)} ` + SPOKE_COUNTS.map((n) => { const r = noPolicy.find((x) => x.pos === pos && x.brake === brake && x.n === n); return `${n}h theme ${r.theme} / backend ${r.backend}${r.same ? '' : ' *'}`; }).join(' | '));
console.log('\nPolicy cases that differ (any hole count, straight-pull hub):');
for (const [label] of CASES.slice(1)) { const rs = rows.filter((r) => r.label === label && r.hubType === 'Straight Pull' && !r.same); console.log(`  ${label}: ${rs.length} of ${rows.filter((r) => r.label === label && r.hubType === 'Straight Pull').length} rows differ`); }
const failing = rows.filter((r) => r.hubType === 'Classic Flange' && r.failed && r.label === 'no policy');
console.log(`\nClassic-flange (J-bend) hubs, no policy: backend refuses ${failing.length} combinations the theme still draws: ` + [...new Set(failing.map((r) => `${r.n}h ${r.pos.toLowerCase()} (${r.brake})`))].join(', '));
