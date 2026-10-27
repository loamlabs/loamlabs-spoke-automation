// I9-SYSTEM: Standard-order before/after proof. Runs the SAME sample Standard orders through the production api/index.js from a git ref
// (default origin/main) and through the working-tree api/index.js, with Shopify and Resend mocked, and compares the order note, the
// email subject + HTML and the inventory adjustments byte for byte.
//   node scripts/standard-proof.mjs                      (before = origin/main)
//   node scripts/standard-proof.mjs --before <git-ref>
//   node scripts/standard-proof.mjs --before-dir <folder with api/index.js and _lib/>
// Output: out/standard-proof/{before,after}/<sample>.* and a summary; exit code 1 on any difference.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from '../tests/helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SAMPLES = ['steel-jbend-wheelset', 'berd-straightpull-front', 'rimbrake-front-own-rear-hub'];
const EVENTS = ['orders/create', 'orders/cancelled'];

let beforeDir = arg('--before-dir');
if (!beforeDir) {
  const ref = arg('--before') || 'origin/main';
  beforeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-before-'));
  // the whole api/ and _lib/ tree of the ref (the baseline may include the System modules; the original pre-System code has only index.js and calculator.js)
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'api', '_lib'], { cwd: root }).toString().split('\n').filter((f) => /\.js$/.test(f));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(beforeDir, f)), { recursive: true });
    fs.writeFileSync(path.join(beforeDir, f), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  }
  // the code imports 'resend' (mocked by the harness loader); @resvg/resvg-js is only loaded lazily by the System path, which a Standard order never reaches
  console.log(`before = ${ref} (extracted to ${beforeDir})`);
}
const afterDir = root;
const outDir = path.join(root, 'out', 'standard-proof');
fs.rmSync(outDir, { recursive: true, force: true });

async function run(indexPath, sample, topic) {
  const order = loadSample('standard', sample);
  if (topic === 'orders/cancelled') {
    // the cancel path reads the note our own create path wrote: use the before-code's note as Shopify would have stored it
    const created = await runWebhook(indexPath, 'orders/create', order, { mock: createMock(loadMockShopify()) });
    order.note = created.note;
  }
  const r = await runWebhook(indexPath, topic, order, { mock: createMock(loadMockShopify()) });
  const email = r.emails[0] || null;
  return {
    status: r.status, note: r.note, inventoryAdjustments: r.inventoryAdjustments,
    emailSubject: email ? email.subject : null, emailHtml: email ? email.html : null, emailTo: email ? email.to : null, emailVia: email ? email.via : null,
    emailCount: r.emails.length
  };
}
function save(side, sample, topic, res) {
  const dir = path.join(outDir, side); fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${sample}.${topic.replace('/', '-')}`);
  fs.writeFileSync(base + '.note.txt', res.note == null ? '(no note written)' : res.note);
  fs.writeFileSync(base + '.email.html', res.emailHtml == null ? '(no email sent)' : res.emailHtml);
  fs.writeFileSync(base + '.result.json', JSON.stringify({ ...res, emailHtml: undefined, note: undefined }, null, 2));
}

let diffs = 0;
const rows = [];
for (const sample of SAMPLES) {
  for (const topic of EVENTS) {
    const before = await run(path.join(beforeDir, 'api', 'index.js'), sample, topic);
    const after = await run(path.join(afterDir, 'api', 'index.js'), sample, topic);
    save('before', sample, topic, before); save('after', sample, topic, after);
    const same = JSON.stringify(before) === JSON.stringify(after);
    if (!same) diffs++;
    rows.push({ sample, topic, status: `${before.status}/${after.status}`, note: before.note === after.note ? 'identical' : 'DIFFERENT', email: before.emailHtml === after.emailHtml && before.emailSubject === after.emailSubject ? (before.emailHtml ? 'identical' : 'none (both)') : 'DIFFERENT', inventory: JSON.stringify(before.inventoryAdjustments) === JSON.stringify(after.inventoryAdjustments) ? `identical (${after.inventoryAdjustments.length} adj.)` : 'DIFFERENT', noteBytes: before.note ? before.note.length : 0, emailBytes: before.emailHtml ? before.emailHtml.length : 0 });
  }
}
console.table(rows);

// ---- INTENDED ADDITIONS: Standard orders that carry the theme's standardStudio key (samples/standard/std-*.json). These are expected to differ, but ONLY by
// additions: the note and the internal email must keep every old line (nothing removed), the subject, the recipient and the inventory / restock behavior must stay
// identical. The differences are written out as unified diffs in out/standard-proof/diff/ for review. A removed line or a changed inventory is a failure.
const INTENDED = fs.readdirSync(path.join(root, 'samples', 'standard')).filter((f) => /^std-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
fs.mkdirSync(path.join(outDir, 'diff'), { recursive: true });
const gitDiff = (a, b) => { try { return execFileSync('git', ['-c', 'core.safecrlf=false', '-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', '--unified=1', a, b], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { return e.stdout ? e.stdout.toString() : String(e); } };
const countLines = (d, sign) => d.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).length;
const intendedRows = [];
let unexpected = 0;
for (const sample of INTENDED) {
  for (const topic of EVENTS) {
    const before = await run(path.join(beforeDir, 'api', 'index.js'), sample, topic);
    const after = await run(path.join(afterDir, 'api', 'index.js'), sample, topic);
    save('before', sample, topic, before); save('after', sample, topic, after);
    const stem = `${sample}.${topic.replace('/', '-')}`;
    const noteDiff = gitDiff(path.join(outDir, 'before', stem + '.note.txt'), path.join(outDir, 'after', stem + '.note.txt'));
    const emailDiff = gitDiff(path.join(outDir, 'before', stem + '.email.html'), path.join(outDir, 'after', stem + '.email.html'));
    fs.writeFileSync(path.join(outDir, 'diff', stem + '.note.diff'), noteDiff || '(identical)\n');
    fs.writeFileSync(path.join(outDir, 'diff', stem + '.email.diff'), emailDiff || '(identical)\n');
    const removed = countLines(noteDiff, '-') + countLines(emailDiff, '-');
    const invSame = JSON.stringify(before.inventoryAdjustments) === JSON.stringify(after.inventoryAdjustments);
    const ok = removed === 0 && invSame && before.status === after.status && before.emailSubject === after.emailSubject && JSON.stringify(before.emailTo) === JSON.stringify(after.emailTo) && before.emailCount === after.emailCount;
    if (!ok) unexpected++;
    intendedRows.push({ sample, topic, 'note lines added': countLines(noteDiff, '+'), 'email lines added': countLines(emailDiff, '+'), 'old lines removed': removed, inventory: invSame ? `identical (${after.inventoryAdjustments.length} adj.)` : 'DIFFERENT', subject: before.emailSubject === after.emailSubject ? 'identical' : 'DIFFERENT', 'sent via': `${before.emailVia || '-'} -> ${after.emailVia || '-'}`, verdict: ok ? 'additions only' : 'UNEXPECTED' });
  }
}
console.log('\nIntended additions (orders that carry standardStudio; diffs in out/standard-proof/diff/):');
console.table(intendedRows);
diffs += unexpected;
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ beforeDir, rows, intendedRows, differences: diffs, generatedAt: new Date().toISOString() }, null, 2));
console.log(diffs ? `\n${diffs} DIFFERENCE(S) that are not intended. See ${outDir}` : `\nAll unkeyed Standard outputs identical before and after; keyed ones differ by additions only. Files in ${outDir}`);
process.exit(diffs ? 1 : 0);
