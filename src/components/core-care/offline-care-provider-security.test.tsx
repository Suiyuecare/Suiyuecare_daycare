// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfflineCareProvider, useOfflineCare } from "./offline-care-provider";
import type { TenantContext } from "@/lib/domain/types";
import type { CareLocalDraft } from "@/lib/offline/care-outbox";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), remove: vi.fn(), synchronize: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => { const router = { refresh: mocks.refresh }; return { useRouter: () => router }; });
vi.mock("@/lib/offline/draft-store", () => ({ getOfflineStorageGeneration: () => "generation-one", loadOfflineDrafts: mocks.load, saveOfflineDraft: mocks.save, removeOfflineDraft: mocks.remove }));
vi.mock("@/lib/offline/care-outbox", async (original) => ({ ...await original<typeof import("@/lib/offline/care-outbox")>(), synchronizeCareDraft: mocks.synchronize }));
const id = "11111111-1111-4111-8111-111111111111";
const actor: TenantContext = { organizationId: id, branchId: id, userId: id, organizationName: "synthetic", branchName: "synthetic", displayName: "synthetic", roles: ["care_worker"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false };
function draft(state: "local" | "queued" = "local"): CareLocalDraft {
  return { id, clientRef: id, kind: "care-note", baseVersion: 0, storageToken: "revision-one", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+86_400_000).toISOString(), payload: { schema: 1, serviceDate: "2026-09-12", state, formValues: { client_id: id, note: "synthetic draft" } } };
}
function TestConsumer() {
  const context = useOfflineCare()!;
  return <><p data-testid="draft-count">{context.drafts.length}</p><button onClick={() => { const item = context.drafts[0]; if (item) { const input = { ...item }; delete input.storageToken; void context.save(input).catch(() => undefined); } }}>Autosave</button></>;
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto); mocks.load.mockResolvedValue([]); mocks.save.mockResolvedValue("revision-saved"); mocks.remove.mockResolvedValue(true); mocks.synchronize.mockResolvedValue({ status: "saved", message: "Saved" }); vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("offline provider revision and expiry controls", () => {
  it("uses the exact queued revision when a network result removes a device draft", async () => {
    const item = draft("queued"); mocks.load.mockResolvedValue([item]);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mocks.remove.mockResolvedValue(false);
    render(<OfflineCareProvider context={actor}><TestConsumer /></OfflineCareProvider>);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), id, "revision-one", "generation-one"));
    expect(await screen.findByText(/另一個分頁已更新這筆草稿/)).toBeInTheDocument();
    expect(screen.getByTestId("draft-count")).toHaveTextContent("1");
  });
  it("does not silently upgrade a local editing baseline from another tab's refresh", async () => {
    vi.useFakeTimers(); const original = draft(); mocks.load.mockResolvedValue([original]);
    await act(async () => { render(<OfflineCareProvider context={actor}><TestConsumer /></OfflineCareProvider>); });
    mocks.load.mockResolvedValue([{ ...original, storageToken: "revision-other-tab" }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { fireEvent.click(screen.getByText("Autosave")); });
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ storageToken: "revision-one" }), "generation-one");
  });
  it("purges expired visible drafts while continuously offline", async () => {
    vi.useFakeTimers(); const item = { ...draft(), expiresAt: new Date(Date.now()+1000).toISOString() };
    mocks.load.mockImplementation(async () => Date.parse(item.expiresAt)>Date.now() ? [item] : []);
    await act(async () => { render(<OfflineCareProvider context={actor}><TestConsumer /></OfflineCareProvider>); });
    expect(screen.getByTestId("draft-count")).toHaveTextContent("1");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByTestId("draft-count")).toHaveTextContent("0"); expect(mocks.synchronize).not.toHaveBeenCalled();
  });
});
