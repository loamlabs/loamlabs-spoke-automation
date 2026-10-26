// Stand-in for the 'resend' package while api/index.js runs in the test harness: records every SDK send instead of calling the network.
export class Resend {
  constructor() {
    this.emails = {
      send: async (opts) => {
        (globalThis.__harness ||= {}).sdkEmails ||= [];
        globalThis.__harness.sdkEmails.push(opts);
        return { data: { id: 'mock-resend-sdk-id' }, error: null };
      }
    };
  }
}
