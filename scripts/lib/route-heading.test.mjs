import { describe, expect, it } from "vitest";
import { hasRouteHeading } from "./route-heading.mjs";

describe("route smoke heading contract", () => {
  it("accepts an accessible focus target and nested heading markup", () => {
    expect(hasRouteHeading('<h1 tabindex="-1" data-governance-focus-anchor>身體評估</h1>', "身體評估")).toBe(true);
    expect(hasRouteHeading('<h1><span>身體</span>評估</h1>', "身體評估")).toBe(true);
  });
  it("does not confuse escaped text, scripts or a different heading with the route", () => {
    expect(hasRouteHeading('<p>&lt;h1&gt;身體評估&lt;/h1&gt;</p><h1>其他頁面</h1>', "身體評估")).toBe(false);
    expect(hasRouteHeading('<script>"<h1>身體評估</h1>"</script><h2>身體評估</h2>', "身體評估")).toBe(false);
  });
  it("requires an exact title instead of a substring", () => {
    expect(hasRouteHeading('<h1>身體評估暫時無法載入</h1>', "身體評估")).toBe(false);
  });
});
