// _lib/http-timeout.js
// Time limits for every outbound call in the webhook path (round 7). A call that hangs used to hold the whole webhook until Vercel killed it;
// now it fails like any other network error, so the code falls into the fallbacks that already exist (Shopify: its retry loop, then the
// "could not read the note / could not fetch components" paths; Resend: images -> text-only -> SDK) and the internal email still goes out.
//
//   Shopify Admin API calls: 8 s per attempt     (env SHOPIFY_FETCH_TIMEOUT_MS overrides, milliseconds)
//   Resend sends:            10 s per send       (env RESEND_FETCH_TIMEOUT_MS overrides, milliseconds)
// The env overrides are optional and exist for tests; leave them unset in production.

export const DEFAULT_SHOPIFY_TIMEOUT_MS = 8000;
export const DEFAULT_RESEND_TIMEOUT_MS = 10000;

function fromEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
export const shopifyTimeoutMs = () => fromEnv('SHOPIFY_FETCH_TIMEOUT_MS', DEFAULT_SHOPIFY_TIMEOUT_MS);
export const resendTimeoutMs = () => fromEnv('RESEND_FETCH_TIMEOUT_MS', DEFAULT_RESEND_TIMEOUT_MS);

// An AbortSignal that fires after ms (pass it as `signal` to fetch; the fetch then rejects with a TimeoutError).
export function timeoutSignal(ms) { return AbortSignal.timeout(ms); }

// For calls that cannot take a signal (the Resend SDK): rejects with a timeout error after ms. The underlying request is not cancelled,
// but the webhook stops waiting for it.
export function withTimeout(promise, ms, label = 'call') {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
