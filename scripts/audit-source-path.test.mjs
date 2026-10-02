import { describe, expect, it } from "vitest";
import { isAuditSourcePath } from "./audit-source-path.mjs";

describe("audit source path segments", () => {
  it.each(["src/app/app/[...slug]/page.tsx", "src/app/[[...slug]]/page.test.tsx", "src/app/error.tsx"])("accepts actual app source %s", (file) => {
    expect(isAuditSourcePath(file)).toBe(true);
  });
  it.each([null, {}, "", "../src/a.ts", "/src/a.ts", "src/../DESIGN.md", "src/a/../../a.ts", "src/./a.ts", "src//a.ts", "src/", "src/a\\..\\a.ts", "src2/a.ts"])("rejects non-source or unsafe segments %s", (file) => {
    expect(isAuditSourcePath(file)).toBe(false);
  });
});
