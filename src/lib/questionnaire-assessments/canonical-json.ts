/** JSON-only canonicalization; never serialize functions or runtime timestamps. */
export function canonicalRuleJson(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, normalize(entry)]));
    }
    throw new Error("Rule catalog contains a non-JSON value.");
  }
  return JSON.stringify(normalize(value));
}
