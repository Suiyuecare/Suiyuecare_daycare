import { describe, expect, it } from "vitest";

import { taipeiLocalToIso } from "@/lib/staff-announcements/date";

import {
  parseStaffAnnouncementApiEnvelope,
  parseStaffAnnouncementInput,
  parseStaffAnnouncementResult,
  staffAnnouncementRpc,
} from "./staff-announcements";

const key = "68000000-0000-4000-8000-000000000001";
const draftId = "68000000-0000-4000-8000-000000000002";
const announcementKey = "68000000-0000-4000-8000-000000000003";
const userId = "68000000-0000-4000-8000-000000000004";

function draftBody() {
  return {
    previous_version_id: null,
    title: "員工公告",
    body: "第一行\n第二行",
    publish_at: "2026-09-02T00:00:00.000Z",
    expires_at: null,
    audience_user_ids: [userId],
    audience_role_ids: [],
    change_reason: null,
  };
}

describe("staff announcement strict integration contract", () => {
  it("round-trips Taipei local time and rejects impossible normalized dates", () => {
    expect(taipeiLocalToIso("2026-02-28T08:30")).toBe("2026-02-28T00:30:00.000Z");
    expect(() => taipeiLocalToIso("2026-02-31T08:30")).toThrow("INVALID_LOCAL_DATETIME");
    expect(() => taipeiLocalToIso("2026-13-01T08:30")).toThrow("INVALID_LOCAL_DATETIME");
  });

  it("requires an explicit nullable expiry field and at least one unique governed selector", () => {
    const withoutExpiry = { ...draftBody() } as Record<string, unknown>;
    delete withoutExpiry.expires_at;
    expect(() => parseStaffAnnouncementInput("draft", withoutExpiry, key)).toThrow();
    expect(() => parseStaffAnnouncementInput("draft", {
      ...draftBody(), audience_user_ids: [], audience_role_ids: [],
    }, key)).toThrow();
    expect(() => parseStaffAnnouncementInput("draft", {
      ...draftBody(), audience_user_ids: [userId, userId],
    }, key)).toThrow();
  });

  it("allows line breaks but rejects unsafe controls and invalid expiry ordering", () => {
    expect(parseStaffAnnouncementInput("draft", draftBody(), key).action).toBe("draft");
    expect(() => parseStaffAnnouncementInput("draft", {
      ...draftBody(), body: "unsafe\u0000text",
    }, key)).toThrow();
    expect(() => parseStaffAnnouncementInput("draft", {
      ...draftBody(), expires_at: "2026-09-01T00:00:00.000Z",
    }, key)).toThrow();
  });

  it("enforces immutable lineage reason semantics", () => {
    expect(() => parseStaffAnnouncementInput("draft", {
      ...draftBody(), previous_version_id: draftId,
    }, key)).toThrow();
    expect(parseStaffAnnouncementInput("draft", {
      ...draftBody(), previous_version_id: draftId, change_reason: "更新內容",
    }, key)).toMatchObject({ previousVersionId: draftId, changeReason: "更新內容" });
  });

  it("maps only the selected action to a narrow RPC", () => {
    const input = parseStaffAnnouncementInput("publish", { draft_version_id: draftId }, key);
    expect(staffAnnouncementRpc(input)).toEqual({
      name: "publish_staff_announcement",
      args: { p_draft_version_id: draftId, p_idempotency_key: key },
    });
  });

  it("accepts an exact database receipt and rejects added sensitive fields", () => {
    const input = parseStaffAnnouncementInput("draft", draftBody(), key);
    const row = {
      version_id: draftId, announcement_key: announcementKey, version: 1,
      previous_version_id: null, version_state: "draft",
      publish_at: "2026-09-02T00:00:00.000Z", expires_at: null, replayed: false,
    };
    expect(parseStaffAnnouncementResult([row], input)).toMatchObject({ persisted: true, demo: false, replayed: false });
    expect(() => parseStaffAnnouncementResult([{ ...row, content_hash: "secret" }], input)).toThrow();
  });

  it("rejects a malicious 2xx envelope whose correlation differs", () => {
    const input = parseStaffAnnouncementInput("publish", { draft_version_id: draftId }, key);
    expect(() => parseStaffAnnouncementApiEnvelope({
      requestId: "68000000-0000-4000-8000-000000000010", status: "ok", errors: [],
      data: {
        action: "publish", versionId: "68000000-0000-4000-8000-000000000011",
        announcementKey, version: 2,
        draftVersionId: "68000000-0000-4000-8000-000000000099",
        lifecycle: "scheduled", publishAt: "2026-09-02T00:00:00.000Z",
        expiresAt: null, recipientCount: 1, replayed: false, persisted: true, demo: false,
      },
    }, input)).toThrow();
  });
});
