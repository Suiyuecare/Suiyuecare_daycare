/**
 * Shared Google/Portal origin guard. The caller supplies trusted configuration,
 * never a Host header, browser claim or return destination.
 * @param {string | undefined} value
 * @param {boolean} allowLocal
 * @returns {string | null}
 */
export function configuredAuthOrigin(value, allowLocal) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(allowLocal && local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}
