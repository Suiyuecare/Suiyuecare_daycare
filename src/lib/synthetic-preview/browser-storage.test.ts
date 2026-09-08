import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOfflineDrafts, loadOfflineDrafts, saveOfflineDraft } from "@/lib/offline/draft-store";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("online synthetic preview has no persistent browser drafts", () => {
  it("refuses save and leaves IndexedDB untouched when reading or leaving preview", async () => {
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "true");
    const open = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("indexedDB", { open, deleteDatabase: remove });
    const namespace = { organizationId: "synthetic", branchId: "synthetic", userId: "synthetic" };
    await expect(saveOfflineDraft(namespace, { id: "synthetic", kind: "care-note", clientRef: "synthetic", baseVersion: 0, payload: "synthetic" }))
      .rejects.toThrow("SYNTHETIC_PREVIEW_STORAGE_DISABLED");
    expect(await loadOfflineDrafts(namespace)).toEqual([]);
    await clearOfflineDrafts();
    expect(open).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
