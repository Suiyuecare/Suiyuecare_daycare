const STAFF_HOME = "/app/dashboard";
const FAMILY_HOME = "/family/home";
const ATTENDANCE_PATH = "/app/staff/service-management/attendance";
const RETURN_ORIGIN = "https://staff-return.invalid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Only this case-attendance workflow may resume after sensitive reauthentication. */
export function safeMfaReturnPath(candidate: string | null, audience: string | null): string {
  if (audience === "family") return FAMILY_HOME;
  if (!candidate || candidate.length > 256 || !candidate.startsWith("/app/") || candidate.startsWith("//") || /[\\\s]/u.test(candidate)) return STAFF_HOME;
  try {
    const parsed = new URL(candidate, RETURN_ORIGIN);
    if (parsed.origin !== RETURN_ORIGIN || parsed.pathname !== ATTENDANCE_PATH || parsed.hash) return STAFF_HOME;
    if ([...parsed.searchParams.keys()].some((key) => !["date", "client", "shift"].includes(key))) return STAFF_HOME;
    const dateValues = parsed.searchParams.getAll("date");
    const clientValues = parsed.searchParams.getAll("client");
    const shiftValues = parsed.searchParams.getAll("shift");
    if (dateValues.length !== 1 || clientValues.length > 1 || shiftValues.length > 1) return STAFF_HOME;
    const date = dateValues[0] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) ||
        new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) return STAFF_HOME;
    const client = clientValues[0];
    if (client && !UUID.test(client)) return STAFF_HOME;
    const shift = shiftValues[0];
    if (shift && shift !== "morning" && shift !== "afternoon" && shift !== "full_day") return STAFF_HOME;
    const params = new URLSearchParams({ date });
    if (client) params.set("client", client);
    if (shift) params.set("shift", shift);
    return `${ATTENDANCE_PATH}?${params}`;
  } catch {
    return STAFF_HOME;
  }
}
