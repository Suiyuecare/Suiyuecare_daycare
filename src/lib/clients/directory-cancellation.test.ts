import { expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
vi.mock("server-only", () => ({}));
import { ClientDirectorySnapshotError, loadAllClientDirectoryRows, loadClientDirectoryPage, type ClientDirectorySupabaseClient } from "./directory";
const context = { organizationId: "d7300000-0000-4000-8000-000000000001", branchId: "d7400000-0000-4000-8000-000000000001" } as TenantContext;

it("never starts an already-cancelled directory read", async () => {
  const controller = new AbortController(); controller.abort(); const rpc = vi.fn();
  await expect(loadAllClientDirectoryRows({ rpc } as unknown as ClientDirectorySupabaseClient, context, "case_center", undefined, controller.signal)).rejects.toBeInstanceOf(ClientDirectorySnapshotError);
  expect(rpc).not.toHaveBeenCalled();
});
it("passes the caller signal to PostgREST and rejects a late result before parsing or pagination", async () => {
  const controller = new AbortController(); let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  const abortSignal = vi.fn(() => promise); const rpc = vi.fn(() => ({ abortSignal }));
  const read = loadAllClientDirectoryRows({ rpc } as unknown as ClientDirectorySupabaseClient, context, "case_center", undefined, controller.signal);
  const assertion = expect(read).rejects.toBeInstanceOf(ClientDirectorySnapshotError);
  controller.abort(); resolve({ data: [], error: null }); await assertion;
  expect(abortSignal).toHaveBeenCalledWith(controller.signal); expect(rpc).toHaveBeenCalledTimes(1);
});
it("keeps existing callers without a signal working without requiring a different transport", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await expect(loadClientDirectoryPage({ rpc } as unknown as ClientDirectorySupabaseClient, context, { purpose: "case_center" })).resolves.toMatchObject({ rows: [] });
});
