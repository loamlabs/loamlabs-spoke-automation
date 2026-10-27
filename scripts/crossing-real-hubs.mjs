// REPORT ONLY. Takes the store's REAL hub products (JSON from scripts/shopify-readonly-catalog.mjs hubs) and, for every hub variant (hole count, position,
// brake interface), compares the crossing the theme draws with the crossing the backend calculation uses, with the hub's real lacing policy and manual value.
//   node scripts/crossing-real-hubs.mjs <hubs.json> [<hubs2.json> ...]  -> out/crossing-real-hubs.md and a summary
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeSource } from '../tests/helpers/theme-studio.mjs';
import { runCalculationEngine } from '../api/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = themeSource();
if (!src) { console.error('LOAM_THEME_DIR=skip: nothing to compare'); process.exit(1); }
const vb = src.read('assets/variant-builder.js');
const block = (name) => { const i = vb.indexOf(`function ${name}(`); const end = vb.indexOf('\n}\n', i); return vb.slice(i, end + 3); };
const theme = new Function(`${block('isLacingPossible')}\n${block('getEstimatedCrossPattern')}\nreturn getEstimatedCrossPattern;`)();

function backendCross(n, pos, brake, hubType, policy, manual) {
  const p = pos.toLowerCase();
  const recipe = { buildType: pos, specs: { brakeStyle: brake, [p + 'SpokeCount']: n + 'h' }, components: {
    [p + 'Rim']: { variantId: 'R', title: 'Rim', selectedOptions: [] }, [p + 'Hub']: { variantId: 'H', title: 'Hub', selectedOptions: [] },
    [p + 'Spokes']: { variantId: 'S', title: 'Spokes', vendor: 'Sapim', selectedOptions: [] } } };
  const meta = new Map();
  meta.set('R', { rim_erd: '600', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.5', rim_target_tension_kgf: '120', rim_spoke_hole_offset: '0' });
  const h = { hub_type: hubType, hub_flange_diameter_left: '58', hub_flange_diameter_right: '58', hub_flange_offset_left: '32', hub_flange_offset_right: '22', hub_spoke_hole_diameter: '2.6', hub_sp_offset_spoke_hole_left: '3', hub_sp_offset_spoke_hole_right: '3' };
  if (policy) h.hub_lacing_policy = policy; if (manual !== undefined && manual !== '') h.hub_manual_cross_value = String(manual);
  meta.set('H', h); meta.set('S', { spoke_cross_section_area_mm2: '2.3' });
  const log = console.log; console.log = () => {};
  let r; try { r = runCalculationEngine(recipe, meta)[p]; } finally { console.log = log; }
  if (!r || !r.calculationSuccessful) return { error: (r && r.error) || 'no result' };
  return { left: r.crossPattern.left, right: r.crossPattern.right };
}

const hubs = process.argv.slice(2).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).filter((p) => p.productMeta.hub_type !== 'System');
const holes = (v) => { const m = String(v.options['Spoke Count'] || '').match(/(\d+)/); return m ? +m[1] : null; };
const report = []; let agree = 0, differ = 0;
for (const p of hubs) {
  const hubType = p.productMeta.hub_type, policy = p.productMeta.hub_lacing_policy || '';
  const rows = new Map();
  for (const v of p.variants) {
    const n = holes(v); if (!n) continue;
    let brakes; try { brakes = JSON.parse(v.meta.wheel_spec_brake_interface || '[]'); } catch (e) { brakes = []; }
    const brakeStyles = brakes.length ? [...new Set(brakes.map((b) => (/rim/i.test(b) ? 'Rim Brake' : '6-Bolt')))] : ['6-Bolt'];
    const pos = /front/i.test(v.meta.wheel_spec_position || p.productMeta.front_or_rear || '') ? 'Front' : 'Rear';
    const manual = v.meta.hub_manual_cross_value ?? p.productMeta.hub_manual_cross_value ?? '';
    for (const brake of brakeStyles) {
      const t = theme({ hub_lacing_policy: policy ? { value: policy } : undefined }, { hub_manual_cross_value: manual !== '' ? { value: String(manual) } : undefined }, n, pos, brake);
      const b = backendCross(n, pos, brake, hubType, policy, manual);
      const bs = b.error ? 'FAILS' : (b.left === b.right ? String(b.left) : `L${b.left}/R${b.right}`);
      const same = !b.error && Number(b.left) === Number(t) && Number(b.right) === Number(t);
      same ? agree++ : differ++;
      const k = `${n}h ${pos} ${brake}: theme ${t}, backend ${bs}${same ? '' : ' **DIFFERENT**'}`;
      rows.set(k, same);
    }
  }
  report.push({ vendor: p.vendor, title: p.title, hubType, policy: policy || '(none)', lines: [...rows.keys()], anyDiff: [...rows.values()].some((x) => !x) });
}
const lines = ['# Real Standard hubs: crossing the theme draws vs the crossing the calculation uses', '', `${hubs.length} hub products, ${agree + differ} hub-variant/brake combinations, ${differ} differ.`, ''];
for (const r of report.filter((x) => x.anyDiff)) lines.push(`- ${r.vendor} | ${r.title} | ${r.hubType} | policy ${r.policy}`, ...r.lines.filter((l) => l.includes('DIFFERENT')).map((l) => `    - ${l}`));
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'crossing-real-hubs.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\nproducts that agree everywhere: ${report.filter((x) => !x.anyDiff).length} of ${report.length}`);
