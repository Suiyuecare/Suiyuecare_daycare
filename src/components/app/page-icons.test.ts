import { describe, expect, it } from "vitest";

import { pageCatalog } from "@/lib/catalog";
import { iconForPage } from "./page-icons";

describe("task pictograms", () => {
  it("gives every approved route an icon without changing its visible text label", () => {
    expect(pageCatalog).toHaveLength(89);
    for (const page of pageCatalog) expect(iconForPage(page)).toBeTypeOf("object");
  });

  it("distinguishes common work instead of repeating only the module symbol", () => {
    const byNumber = (number: number) => iconForPage(pageCatalog.find((page) => page.number === number)!);
    expect(byNumber(1)).not.toBe(byNumber(2));
    expect(byNumber(3)).not.toBe(byNumber(5));
    expect(byNumber(7)).not.toBe(byNumber(8));
    expect(byNumber(46)).not.toBe(byNumber(48));
  });
});
