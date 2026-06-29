/**
 * Register the service worker that precaches the app shell for full offline
 * use. Guarded so it silently no-ops where service workers are unavailable
 * (e.g. some sandboxes or non-secure contexts).
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
}
