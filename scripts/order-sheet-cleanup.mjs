// Retention for the saved order sheets: PNG images are kept 12 months, the sheet JSON 24 months (the dates are on each row: images_expire_at, expires_at).
//   node scripts/order-sheet-cleanup.mjs            dry run: says how many rows have expired images and how many rows have expired, deletes nothing
//   node scripts/order-sheet-cleanup.mjs --apply    deletes the expired images from the bucket (the row keeps its sheet) and the expired rows (with their images)
// Run it by hand, for example once a month (a dry run first). Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SHOPIFY_STORE_DOMAIN in the environment (the same names as the Vercel
// project). Prints counts only: no key, no order data.
import { cleanupExpired } from '../_lib/order-sheet-store.js';

const apply = process.argv.includes('--apply');
try {
  const r = await cleanupExpired({ apply });
  console.log(apply ? 'Done.' : 'Dry run: nothing was deleted.', JSON.stringify(r));
  if (!apply && (r.rowsWithExpiredImages || r.rowsExpired)) console.log('Run again with --apply to delete them.');
} catch (e) {
  console.error('Could not clean up:', e && e.message ? e.message : e);
  process.exit(1);
}
