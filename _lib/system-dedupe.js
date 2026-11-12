// _lib/system-dedupe.js
// I9-SYSTEM: idempotency for System orders. Shopify can deliver the same orders/create webhook more than once; without a guard the
// internal and the customer email would go out twice. Three layers, none of which needs new infrastructure:
//
//   1. In-process claim (this file): the first delivery of an order claims it synchronously, before any await, so a concurrent duplicate
//      that lands on the same warm instance is dropped. Expires after CLAIM_TTL_MS; released if the System path crashes so a re-delivery
//      can try again.
//   2. The delivered payload's note: if it already contains the System report marker the order was processed.
//   3. The order's LIVE note in Shopify (api/index.js getOrderNote): the System path writes the report to the order note BEFORE it sends
//      any email, so the note is the durable "already processed" record that survives across serverless instances. If the lookup fails the
//      order is processed anyway (a missed report is worse than a rare duplicate).
//
// Not covered: two duplicates landing at the same moment on two different cold instances (both would pass layers 1 to 3 before either has
// written the note). Closing that gap needs a shared store (for example Redis); see the report.

// The record that a System order was processed is in its note. Two shapes, both recognised:
//  - the header "AUTOMATED SYSTEM BUILD REPORT" that notes had before the note was made short for the packing slip (orders processed earlier keep it);
//  - the wheel line that starts each wheel block of the clean note (noteText in _lib/system-report.js): "FRONT  <rim>  /  <hub>, <hub color>" and "REAR   <rim>  /  <hub>, <hub color>".
//    The clean note has no header on purpose (the customer reads it); a wheel line is the first line of every block and every System note has at least one.
export const SYSTEM_REPORT_MARKER = 'AUTOMATED SYSTEM BUILD REPORT';
export const SYSTEM_NOTE_WHEEL_LINE = /^(?:FRONT {2}|REAR {3}).+ {2}\/ {2}.+, .+$/gm;
// First words of every Standard order note (formatNote in api/index.js). The same guard protects Standard orders that carry the standardStudio key.
export const STANDARD_REPORT_MARKER = 'AUTOMATED SPOKE CALCULATION & INVENTORY';

export const CLAIM_TTL_MS = 30 * 60 * 1000;

const claims = new Map(); // key -> claimedAt (ms)

function prune(now) {
  for (const [k, t] of claims) if (now - t >= CLAIM_TTL_MS) claims.delete(k);
}

// true = this call owns the order; false = it is already claimed (duplicate delivery).
export function claimSystemOrder(key, now = Date.now()) {
  if (!key) return true; // nothing to key on: cannot dedupe in process, let the note layers decide
  prune(now);
  if (claims.has(key)) return false;
  claims.set(key, now);
  return true;
}

export function releaseSystemOrder(key) {
  if (key) claims.delete(key);
}

// Test helper: forget every claim.
export function resetSystemDedupe() {
  claims.clear();
}

export function noteHasSystemReport(note) {
  return markerCount(note) > 0;
}

function markerCount(note, marker = SYSTEM_REPORT_MARKER) {
  if (typeof note !== 'string') return 0;
  const n = note.split(marker).length - 1;
  if (marker !== SYSTEM_REPORT_MARKER) return n;
  return n + (note.match(SYSTEM_NOTE_WHEEL_LINE) || []).length; // System: old header plus wheel lines of the clean note
}

// REVIEW: the delivered payload's note is the customer's checkout note (or, for an order duplicated in the admin, a copy of an old
// order's note), so the marker being IN it proves nothing: a customer who typed "AUTOMATED SYSTEM BUILD REPORT" at checkout, or a
// staff-duplicated System order, was silently skipped. The record of processing is the marker that the System path APPENDED, i.e.
// the live note holds one more marker than the delivered note. (Shopify re-delivers the original payload, so on a duplicate delivery
// the delivered note is the same as on the first one.) liveNote null = could not be read -> not processed (fail open, as before).
// marker defaults to the System one; the Standard path passes STANDARD_REPORT_MARKER.
export function noteShowsProcessed(liveNote, deliveredNote, marker = SYSTEM_REPORT_MARKER) {
  if (typeof liveNote !== 'string') return false;
  return markerCount(liveNote, marker) > markerCount(deliveredNote, marker);
}
