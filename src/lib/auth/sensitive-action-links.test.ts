import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(file);
    return file.endsWith(".tsx") && !file.endsWith(".test.tsx") ? [file] : [];
  });
}

describe("explicit sensitive-action reauthentication links", () => {
  it("keeps all existing manual step-up links actionable without restoring login enrollment", () => {
    const links = componentFiles(join(process.cwd(), "src/components")).flatMap((file) =>
      Array.from(readFileSync(file, "utf8").matchAll(/href="(\/mfa[^"]*)"/gu),
        (match) => ({ file, href: match[1]! })),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const { file, href } of links) {
      const destination = new URL(href, "https://daycare.example.test");
      expect(destination.searchParams.getAll("purpose"), file).toEqual(["sensitive-action"]);
      expect(destination.searchParams.get("audience"), file).not.toBe("family");
      expect(destination.searchParams.has("next"), file).toBe(false);
    }
  });
});
