// Validate repository-relative paths by segments: App Router's [...slug] is
// legitimate, while a parent-directory segment must never enter the snapshot.
export function isAuditSourcePath(file) {
  return typeof file === "string" && file.startsWith("src/") && !file.includes("\\") &&
    file.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
