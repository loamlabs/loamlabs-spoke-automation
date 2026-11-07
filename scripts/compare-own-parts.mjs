// OWN-PARTS proof: the webhook of a baseline git ref (default main) against the working tree for EVERY sample order (standard and system) and the preconfigured fixture.
// Expected: ALL byte-identical (no sample has customer parts or a quantity above 1).
//   node scripts/compare-own-parts.mjs [baseline-ref]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'main';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-nr-'));
for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '_lib', 'api'], { cwd: root }).toString().split('\n').filter((x) => /\.js$/.test(x))) {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
try { fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction'); } catch (e) { /* resolve from the baseline copy too */ }

const H = await import(pathToFileURL(path.join(root, 'tests/helpers/webhook-harness.mjs')).href);
const P = await import(pathToFileURL(path.join(root, 'tests/helpers/preconfigured-order.mjs')).href);
const stripNote = (t) => t.replace(/^ {2}Nipples: .*\n/gm, '');
const stripHtml = (t) => t.replace(/\n *<tr><td>Nipples<\/td><td>[^<]*<\/td><\/tr>/g, '');
const cases = [];
for (const kind of ['standard', 'system']) for (const f of fs.readdirSync(path.join(root, 'samples', kind)).filter((x) => x.endsWith('.json') && x !== 'mock-shopify.json')) cases.push([`${kind}/${f.replace('.json', '')}`, () => H.loadSample(kind, f.replace('.json', ''))]);
cases.push(['fixture/preconfigured master', () => P.preconfiguredOrder()], ['fixture/custom build, no rule', () => P.preconfiguredOrder({ rule: null })]);
const mockOf = (o) => (o._sample && o._sample.metafields ? H.createMock({ ...H.loadMockShopify(), metafields: o._sample.metafields, variantColors: ['Black', 'Black Berd', 'White Berd', 'Silver', 'Blue Berd'], variantLengths: [240, 330] }) : (o.line_items && o.line_items[0] && o.line_items[0].properties && o.line_items[0].properties.some((p) => p.name === '_Preconfigured_Rule') ? H.createMock(P.preconfiguredMock()) : undefined));
let identical = 0, rowsOnly = 0, bad = 0;
for (const [name, make] of cases) {
  const run = async (idx) => { const o = make(); try { return await H.runWebhook(idx, 'orders/create', o, { mock: mockOf(o) }); } catch (e) { return { error: String(e).slice(0, 120) }; } };
  const a = await run(path.join(dir, 'api', 'index.js')), b = await run(path.join(root, 'api', 'index.js'));
  if (a.error || b.error) { console.log(`ERR  ${name}: ${a.error || ''} ${b.error || ''}`); bad++; continue; }
  const mailA = a.emails.map((e) => e.html).join('\n'), mailB = b.emails.map((e) => e.html).join('\n');
  const raw = a.note === b.note && mailA === mailB;
  const same = stripNote(b.note) === a.note && stripHtml(mailB) === mailA && a.emails.map((e) => e.subject).join() === b.emails.map((e) => e.subject).join() && JSON.stringify(a.inventoryAdjustments) === JSON.stringify(b.inventoryAdjustments) && a.status === b.status;
  if (raw) identical++; else if (same) { rowsOnly++; console.log(`ROWS ${name}: differs only by the expected lines`); } else { bad++; console.log(`BAD  ${name}: differs beyond the rows`); }
}
console.log(`${cases.length} orders: ${identical} byte-identical, ${rowsOnly} differ only by the expected lines, ${bad} bad (baseline ${ref})`);
process.exit(bad ? 1 : 0);
