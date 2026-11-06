// EMAIL-LINES proof: the webhook of a baseline git ref (default main) against the working tree, for the same fake orders.
// Orders without a freehub body and without a rule must produce byte-identical note, email, subject and stock; the other orders must differ ONLY by the new lines.
//   node scripts/compare-email-lines.mjs [baseline-ref]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'main';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-el-'));
for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '_lib', 'api'], { cwd: root }).toString().split('\n').filter((x) => /\.js$/.test(x))) {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
try { fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction'); } catch (e) { /* resolve from the baseline copy too */ }

const { runWebhook, createMock } = await import(pathToFileURL(path.join(root, 'tests/helpers/webhook-harness.mjs')).href);
const { preconfiguredOrder, preconfiguredMock, preconfiguredBuild } = await import(pathToFileURL(path.join(root, 'tests/helpers/preconfigured-order.mjs')).href);
const withFreehub = (t) => { const b = preconfiguredBuild(); b.components.rearComponentFreehub = { variantId: 'gid://shopify/ProductVariant/9199', title: 'Test Freehub', variantTitle: t, price: 0 }; return b; };
const CASES = [
  ['standard custom build (no rule, no freehub body)', () => preconfiguredOrder({ rule: null }), false],
  ['old preconfigured master (rule, no freehub body)', () => preconfiguredOrder(), true],
  ['custom build with a freehub body (no rule)', () => preconfiguredOrder({ rule: null, build: withFreehub('MS') }), true],
  ['hub-choice style (rule + XD body)', () => preconfiguredOrder({ rule: 'LoamLabs Reserve 30|DH Mullet + Industry Nine Hydra2 15x110/12x148', build: withFreehub('XD') }), true]
];
const strip = (t) => t.replace(/^ {2}Freehub body: .*\n/gm, '').replace(/^ {2}Rule: .*\n/gm, '').replace(/\n *<tr><td>(Freehub body|Rule)<\/td><td>[^<]*<\/td><\/tr>/g, '');
let bad = 0;
for (const [name, make, differs] of CASES) {
  const a = await runWebhook(path.join(dir, 'api', 'index.js'), 'orders/create', make(), { mock: createMock(preconfiguredMock()) });
  const b = await runWebhook(path.join(root, 'api', 'index.js'), 'orders/create', make(), { mock: createMock(preconfiguredMock()) });
  const raw = a.note === b.note && a.emails[0].html === b.emails[0].html;
  const same = strip(a.note) === strip(b.note) && strip(a.emails[0].html) === strip(b.emails[0].html) && a.emails[0].subject === b.emails[0].subject
    && JSON.stringify(a.inventoryAdjustments) === JSON.stringify(b.inventoryAdjustments) && a.status === b.status && a.emails.length === b.emails.length;
  const ok = same && (differs ? !raw : raw);
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'}  ${name}: ${raw ? 'byte-identical' : 'differs only by the new lines'}${same ? '' : ' (BUT differs elsewhere)'}`);
}
console.log(bad ? `${bad} comparison(s) failed` : `all ${CASES.length} comparisons as expected (baseline ${ref})`);
process.exit(bad ? 1 : 0);
