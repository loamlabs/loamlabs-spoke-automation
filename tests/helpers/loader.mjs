// Module loader hook: 'resend' -> tests/helpers/resend-mock.mjs (registered by webhook-harness.mjs).
export async function resolve(specifier, context, next) {
  if (specifier === 'resend') return { url: new URL('./resend-mock.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
