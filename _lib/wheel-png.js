// _lib/wheel-png.js
// I9-SYSTEM: SVG -> PNG on the server with @resvg/resvg-js (a native, dependency-free renderer that ships a Linux x64 binary for
// Vercel's serverless runtime; about 4.5 MB per platform, ~0.3 s cold for a 600 px wheel). The library is imported lazily so a
// missing or broken native binary surfaces as a catchable error at render time and can never stop the webhook from answering.

export async function svgToPng(svg, { width = 600 } = {}) {
  const { Resvg } = await import('@resvg/resvg-js');
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#ffffff' });
  return Buffer.from(r.render().asPng());
}
