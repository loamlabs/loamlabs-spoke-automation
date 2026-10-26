// I9-SYSTEM: renders every System sample order to PNGs + the email HTML + the order note, for a quick look without sending anything.
//   node scripts/render-system-samples.mjs            -> out/system-samples/<sample>/{*.png, email.html, note.txt, report.json}
//   node scripts/render-system-samples.mjs --send     -> also emails each report to BUILDER_EMAIL_ADDRESS with the local .env (RESEND_API_KEY)
// out/system-samples/index.html links everything.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSystemBuildRecipe } from '../_lib/system-build.js';
import { buildSystemReport, sendSystemEmail } from '../_lib/system-report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const send = process.argv.includes('--send');
if (send) { try { (await import('dotenv')).config({ path: path.join(root, '.env') }); } catch (e) { /* dotenv optional */ } }

const samplesDir = path.join(root, 'samples', 'system');
const outDir = path.join(root, 'out', 'system-samples');
fs.mkdirSync(outDir, { recursive: true });
const names = fs.readdirSync(samplesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
let index = '<!doctype html><meta charset="utf-8"><title>System sample renders</title><body style="font-family:sans-serif">';
for (const name of names) {
  const order = JSON.parse(fs.readFileSync(path.join(samplesDir, name + '.json'), 'utf8'));
  const found = findSystemBuildRecipe(order);
  if (!found) { console.log(`${name}: not a System build, skipped`); continue; }
  const t0 = Date.now();
  const report = await buildSystemReport({ recipe: found.recipe, orderData: order });
  const dir = path.join(outDir, name); fs.mkdirSync(dir, { recursive: true });
  let html = report.html;
  for (const img of report.images) {
    fs.writeFileSync(path.join(dir, img.filename), img.png);
    fs.writeFileSync(path.join(dir, img.filename.replace(/\.png$/, '.svg')), img.svg);
    html = html.split(`cid:${img.cid}`).join(img.filename);
  }
  fs.writeFileSync(path.join(dir, 'email.html'), html);
  fs.writeFileSync(path.join(dir, 'note.txt'), report.note);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ subject: report.subject, warnings: report.warnings, imageErrors: report.imageErrors, lengths: report.lengths, wheels: report.wheels.map((w) => ({ position: w.position, hubModel: w.hubModel, hubColor: w.hubColor, spokeCountLabel: w.spokeCountLabel, isMultiColor: w.isMultiColor, counts: w.counts, config: w.config, feeLines: w.feeLines })), images: report.images.map((i) => ({ filename: i.filename, bytes: i.png.length, caption: i.caption })) }, null, 2));
  const ms = Date.now() - t0;
  console.log(`${name}: ${report.images.length} image(s) ${report.images.map((i) => `${i.filename} ${(i.png.length / 1024).toFixed(1)}KB`).join(', ')}${report.imageErrors.length ? ' | ERRORS: ' + report.imageErrors.join('; ') : ''} | ${ms} ms${report.warnings.length ? ' | warnings: ' + report.warnings.join(' / ') : ''}`);
  index += `<h2>${name}</h2><p><a href="${name}/email.html">email.html</a> | <a href="${name}/note.txt">note.txt</a> | <a href="${name}/report.json">report.json</a></p><div style="display:flex;gap:12px;flex-wrap:wrap">` +
    report.images.map((i) => `<figure style="margin:0"><img src="${name}/${i.filename}" width="300"><figcaption>${i.caption}</figcaption></figure>`).join('') + '</div>';
  if (send) {
    try { const r = await sendSystemEmail({ report, orderData: order }); console.log(`   sent: ${r.id} (${r.inline ? 'inline images' : 'text only'})`); }
    catch (e) { console.error(`   send failed: ${e.message}`); }
  }
}
fs.writeFileSync(path.join(outDir, 'index.html'), index);
console.log('index:', path.join(outDir, 'index.html'));
