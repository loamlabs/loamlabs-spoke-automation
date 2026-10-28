// Module loader hook: 'resend' -> tests/helpers/resend-mock.mjs (registered by webhook-harness.mjs).
// An api/index.js imported with the query "breakSystemReport=1" gets a _lib/system-report.js whose buildSystemReport throws (the real exports otherwise),
// to test the plain internal email that goes out when the System report itself fails (no real input makes it throw).
export async function resolve(specifier, context, next) {
  if (specifier === 'resend') return { url: new URL('./resend-mock.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier.endsWith('_lib/system-report.js') && String(context.parentURL || '').includes('breakSystemReport=1')) {
    const real = await next(specifier, context);
    return { url: new URL('./system-report-broken.mjs', import.meta.url).href + '?real=' + encodeURIComponent(real.url), shortCircuit: true };
  }
  return next(specifier, context);
}
