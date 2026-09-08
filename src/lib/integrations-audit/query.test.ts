import { describe, expect, it } from "vitest";

import {
  defaultIntegrationsAuditFilters,
  integrationsAuditFilterHref,
  parseIntegrationsAuditQuery,
} from "./query";

describe("Page 83 integrations/audit query", () => {
  const now = new Date("2026-09-08T04:00:00.000Z");

  it("defaults to the latest 30 inclusive Taipei calendar days", () => {
    expect(defaultIntegrationsAuditFilters(now)).toEqual({
      startDate: "2026-08-10",
      endDate: "2026-09-08",
      integrationKey: "all",
      activityState: "all",
      auditAction: "all",
      resourceCategory: "all",
      actorUserId: null,
      correlationId: null,
    });
  });

  it("parses and serializes only the exact stable filter vocabulary", () => {
    const filters = parseIntegrationsAuditQuery(new URLSearchParams({
      from: "2026-09-01",
      to: "2026-09-08",
      integration: "referral_notification_outbox",
      state: "attention",
      action: "integration",
      resource: "professional_service",
      actor: "83000000-0000-4000-8000-000000000083",
      correlation: "83000000-0000-4000-8000-000000000084",
    }), now);
    expect(filters.integrationKey).toBe("referral_notification_outbox");
    expect(filters.correlationId).toBe("83000000-0000-4000-8000-000000000084");
    expect(integrationsAuditFilterHref(filters)).toBe(
      "?from=2026-09-01&to=2026-09-08&integration=referral_notification_outbox" +
      "&state=attention&action=integration&resource=professional_service" +
      "&actor=83000000-0000-4000-8000-000000000083" +
      "&correlation=83000000-0000-4000-8000-000000000084",
    );
  });

  it.each([
    "unknown=x",
    "from=2026-02-30",
    "from=2026-09-08&to=2026-09-07",
    "from=2026-01-01&to=2026-04-01",
    "integration=line",
    "state=healthy",
    "action=login",
    "resource=raw_table",
    "actor=not-a-uuid",
    "correlation=not-a-uuid",
    "from=2026-09-01&from=2026-09-02",
  ])("rejects invalid, widened, or ambiguous input: %s", (query) => {
    expect(() => parseIntegrationsAuditQuery(new URLSearchParams(query), now))
      .toThrow("INVALID_INTEGRATIONS_AUDIT_FILTERS");
  });
});
