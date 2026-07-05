/** Stub for cloud PWA builds — driver web runs in the browser, not Capacitor native. */
export const Preferences = {
  async get() {
    return { value: null };
  },
  async set() {},
  async remove() {},
};
