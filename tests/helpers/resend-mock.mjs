// Stand-in for the 'resend' package while api/index.js runs in the test harness: records every SDK send instead of calling the network.
// A test can make the SDK slow with globalThis.__harness.sdkDelayMs (the send then resolves after that many milliseconds, as a hung request would).
export class Resend {
  constructor() {
    this.emails = {
      send: async (opts) => {
        const h = (globalThis.__harness ||= {});
        if (h.sdkDelayMs) { await new Promise((r) => setTimeout(r, h.sdkDelayMs).unref()); }
        h.sdkEmails ||= [];
        h.sdkEmails.push(opts);
        return { data: { id: 'mock-resend-sdk-id' }, error: null };
      }
    };
  }
}
