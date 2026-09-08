import { describe, expect, it } from "vitest";

import {
  authorizedCarePlanFilterHref,
  defaultAuthorizedCarePlanFilters,
  parseAuthorizedCarePlanFilters,
} from "./query";

describe("Page 55 authorized-care-plan query", () => {
  const now = new Date("2026-09-08T04:00:00.000Z");

  it("uses an Asia/Taipei date and bounded defaults", () => {
    expect(defaultAuthorizedCarePlanFilters(now)).toEqual({
      asOf: "2026-09-08",
      clientId: null,
      authorizedFrom: null,
      authorizedTo: null,
      effectiveState: "all",
      sourceSystem: null,
      page: 1,
      pageSize: 25,
    });
  });

  it("parses the exact whitelist without silently widening values", () => {
    const filters = parseAuthorizedCarePlanFilters(new URLSearchParams({
      as_of: "2026-09-30",
      client: "55010000-0000-4000-8000-000000000001",
      authorized_from: "2026-08-01",
      authorized_to: "2026-08-31",
      effective: "current",
      source: "central_html",
      page: "2",
      page_size: "10",
    }), now);
    expect(filters).toMatchObject({
      asOf: "2026-09-30",
      clientId: "55010000-0000-4000-8000-000000000001",
      authorizedFrom: "2026-08-01",
      authorizedTo: "2026-08-31",
      effectiveState: "current",
      sourceSystem: "central_html",
      page: 2,
      pageSize: 10,
    });
    expect(authorizedCarePlanFilterHref(filters)).toContain("effective=current");
  });

  it.each([
    "unknown=x",
    "as_of=2026-02-30",
    "client=not-a-uuid",
    "authorized_from=2026-09-02&authorized_to=2026-09-01",
    "effective=signed",
    "source=%00bad",
    "page=0",
    "page=201",
    "page_size=26",
    "as_of=2026-09-08&as_of=2026-09-09",
  ])("rejects invalid or ambiguous input: %s", (query) => {
    expect(() => parseAuthorizedCarePlanFilters(new URLSearchParams(query), now))
      .toThrow("INVALID_AUTHORIZED_CARE_PLAN_FILTERS");
  });
});
