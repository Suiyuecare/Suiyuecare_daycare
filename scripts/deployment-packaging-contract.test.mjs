import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const patterns = readFileSync(resolve(import.meta.dirname, "../.vercelignore"), "utf8").split(/\r?\n/u)
  .filter((line) => line && !line.startsWith("#"));

describe("deployment packaging privacy contract", () => {
  it.each(["/private", "/uploads", "/imports", "/exports", "/backups", "/artifacts", "/output", "/test-results", "/playwright-report"])(
    "explicitly excludes private or generated directory %s", (pattern) => expect(patterns).toContain(pattern),
  );
  it.each(["*.html", "*.htm", "*.pdf", "*.docx", "*.xlsx", "*.csv", "*.sqlite", "*.sqlite3", "*.db", "*.dump", "*.sql.gz", "*.pem", "*.key", "*.p12", "*.pfx"])(
    "explicitly excludes case exports, databases or credential type %s", (pattern) => expect(patterns).toContain(pattern),
  );
  it("keeps environment values and engineering-only fixtures out of CLI source uploads", () => {
    for (const pattern of [".env*", "/supabase", "/tests", "/scripts", "/.github", "src/**/*.test.ts", "src/**/*.test.tsx"]) expect(patterns).toContain(pattern);
  });
  it("does not blanket-exclude application source, public UI assets or PDF fonts", () => {
    for (const pattern of ["*", "/*", "/src", "/public", "/assets", "*.ts", "*.tsx", "*.css", "*.png", "*.svg", "*.ttf"]) expect(patterns).not.toContain(pattern);
  });
});
