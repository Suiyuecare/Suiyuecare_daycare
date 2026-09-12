import { describe, expect, it } from "vitest";
import { latestDiaryRevisions } from "./revisions";
import { projectDailyCareSnapshot } from "@/lib/core-care/projection";
describe("one diary event across immutable revisions", () => {
  it("edit submit sign and correction produce one current source count", () => {
    const statuses = ["draft", "draft", "submitted", "signed", "draft", "submitted", "corrected"] as const;
    const rows = statuses.map((status, index) => ({ id: `revision-${index}`, record_key: "event-1", version: index + 1, client_id: "client-1", occurred_at: "2026-09-12T01:00:00Z", status, data: { fields: { abnormal: true } } }));
    const latest = latestDiaryRevisions(rows.reverse());
    expect(latest).toHaveLength(1); expect(latest[0]?.status).toBe("corrected");
    const snapshot = projectDailyCareSnapshot({ serviceDate: "2026-09-12", generatedAt: "2026-09-12T02:00:00Z", clients: [{ id: "client-1", client_code: "SYN-1", display_name: "合成個案" }], attendance: [], measurements: [], serviceEvents: [], careDiaries: latest });
    expect(snapshot.sourceCounts.careDiaryRecords).toBe(1); expect(snapshot.clients[0]?.careDiary?.status).toBe("corrected");
  });
  it("never merges distinct events just because they share the same time or client", () => {
    const row = { id: "one", occurred_at: "2026-09-12T01:00:00Z" };
    expect(latestDiaryRevisions([row, { ...row, id: "two" }])).toHaveLength(2);
  });
});
