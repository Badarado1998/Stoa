// Runs once when a server instance starts. Node 25+ defines globalThis.localStorage and sessionStorage as getters that
// print an ExperimentalWarning on every read when no --localstorage-file is given; libraries that check for browser
// storage during server rendering hit them on every page, which buried real errors in the logs. On the server there
// is no browser storage, so they become plain undefined values, which is what those checks expect.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  for (const k of ["localStorage", "sessionStorage"]) {
    const d = Object.getOwnPropertyDescriptor(globalThis, k);
    if (d?.get) Object.defineProperty(globalThis, k, { value: undefined, writable: true, configurable: true, enumerable: false });
  }
}
