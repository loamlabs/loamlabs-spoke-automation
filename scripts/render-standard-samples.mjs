// Renders every Standard sample that carries standardStudio through the REAL webhook code (Shopify and Resend mocked, customer flag on so the customer email
// is built too) and writes what it produced for a quick look. Nothing is sent anywhere.
//   node scripts/render-standard-samples.mjs     -> out/standard-samples/<sample>/{internal-email.html, customer-email.html, note.txt, *.png, summary.json}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample } from '../tests/helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const index = path.join(root, 'api', 'index.js');
const samplesDir = path.join(root, 'samples', 'standard');
const outDir = path.join(root, 'out', 'standard-samples');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const names = fs.readdirSync(samplesDir).filter((f) => /^std-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
let page = '<!doctype html><meta charset="utf-8"><title>Standard sample renders</title><body style="font-family:sans-serif">';
for (const name of names) {
  const r = await runWebhook(index, 'orders/create', loadSample('standard', name), { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  const dir = path.join(outDir, name); fs.mkdirSync(dir, { recursive: true });
  const internal = r.emails.find((e) => /^Spoke Calculation Complete/.test(e.subject)), customer = r.emails.find((e) => /^Your custom spoke colors/.test(e.subject));
  const save = (file, html, atts) => { let h = html; for (const a of atts || []) { h = h.split(`cid:${a.content_id}`).join(a.filename); fs.writeFileSync(path.join(dir, a.filename), Buffer.from(a.content, 'base64')); } fs.writeFileSync(path.join(dir, file), h); };
  if (internal) save('internal-email.html', internal.html, internal.attachments);
  if (customer) save('customer-email.html', customer.html, customer.attachments);
  fs.writeFileSync(path.join(dir, 'note.txt'), r.note || '(no note)');
  const errors = r.logs.filter(([l]) => l === 'error').map(([, m]) => m.slice(0, 300));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ status: r.status, inventoryAdjustments: r.inventoryAdjustments.length, emails: r.emails.map((e) => ({ via: e.via, subject: e.subject, to: e.to, images: (e.attachments || []).map((a) => a.content_id) })), errors }, null, 2));
  console.log(`${name}: ${internal ? (internal.attachments || []).length : 0} image(s) | emails: ${r.emails.map((e) => e.subject.slice(0, 28)).join(' | ')}${errors.length ? ' | ERRORS: ' + errors.join('; ') : ''}`);
  page += `<h2>${name}</h2><p><a href="${name}/internal-email.html">internal-email.html</a> | <a href="${name}/customer-email.html">customer-email.html</a> | <a href="${name}/note.txt">note.txt</a></p><div style="display:flex;gap:12px;flex-wrap:wrap">` +
    (internal && internal.attachments || []).map((a) => `<figure style="margin:0"><img src="${name}/${a.filename}" width="260"><figcaption>${a.filename}</figcaption></figure>`).join('') + '</div>';
}
fs.writeFileSync(path.join(outDir, 'index.html'), page);
console.log('index:', path.join(outDir, 'index.html'));
