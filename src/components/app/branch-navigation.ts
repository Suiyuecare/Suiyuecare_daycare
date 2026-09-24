const DEFAULT_STAFF_PATH = "/app/staff/workspace/dashboard";

/** Keep the current staff page, but never retain the previous branch's query or hash. */
export function safeStaffReloadPath(input: string) {
  try {
    if (input.includes("\\")) return DEFAULT_STAFF_PATH;
    const url = new URL(input, "https://daycare.invalid");
    if (url.origin !== "https://daycare.invalid" || !/^\/app(?:\/|$)/u.test(url.pathname) || /\\|\/\/|%2f|%5c/iu.test(url.pathname)) return DEFAULT_STAFF_PATH;
    return url.pathname;
  } catch { return DEFAULT_STAFF_PATH; }
}

export function reloadCurrentStaffRoute() {
  window.location.replace(safeStaffReloadPath(window.location.pathname));
}
