import { beforeEach, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  context: vi.fn(), directory: vi.fn(), workspace: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: stubs.notFound }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: stubs.context }));
vi.mock("@/lib/jubo-pending-director/server", () => ({
  readPendingDirectorDirectory: stubs.directory,
  readPendingDirectorWorkspace: stubs.workspace,
}));
vi.mock("@/lib/clients/lifecycle-rules", () => ({ taipeiDate: () => "2026-10-09" }));
vi.mock("@/components/jubo-pending-director/workspace", () => ({
  PendingIntakeDirectorWorkspace: () => null,
}));

import PendingIntakeReviewPage from "./page";

const actor = {
  demo: false, organizationId: "a1000000-0000-4000-8000-000000000001",
  branchId: "a2000000-0000-4000-8000-000000000001", branchName: "合成分支",
  roles: ["branch_director"], scopes: ["clients.jubo_pending_source.read", "clients.intake_draft.manage"],
};
const render = (client?: string) => PendingIntakeReviewPage({ searchParams: Promise.resolve(client ? { client } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  stubs.context.mockResolvedValue(actor);
  stubs.directory.mockResolvedValue({ total: 0, clients: [] });
});

it.each([
  ["demo", { demo: true }],
  ["non-director", { roles: ["care_worker"] }],
  ["missing source scope", { scopes: ["clients.intake_draft.manage"] }],
  ["missing draft scope", { scopes: ["clients.jubo_pending_source.read"] }],
])("returns a denied route for %s before querying a pending client", async (_name, change) => {
  stubs.context.mockResolvedValue({ ...actor, ...change });
  await expect(render()).rejects.toThrow("NOT_FOUND");
  expect(stubs.directory).not.toHaveBeenCalled();
  expect(stubs.workspace).not.toHaveBeenCalled();
});

it("reads only the selected client from the director's current branch", async () => {
  const clientId = "a3000000-0000-4000-8000-000000000001";
  stubs.directory.mockResolvedValue({ total: 1, clients: [{ clientId, displayName: "合成個案", clientCode: "SYN-1", sourceStatus: "服務中" }] });
  stubs.workspace.mockResolvedValue({ clientId, formalOperationsAllowed: false });
  const page = await render(clientId);
  expect(stubs.directory).toHaveBeenCalledWith(actor.organizationId, actor.branchId);
  expect(stubs.workspace).toHaveBeenCalledWith(actor.organizationId, actor.branchId, clientId);
  expect(page.props.initialWorkspace).toEqual({ clientId, formalOperationsAllowed: false });
});

it("does not query a client omitted from the branch directory", async () => {
  const page = await render("a3000000-0000-4000-8000-000000000002");
  expect(stubs.workspace).not.toHaveBeenCalled();
  expect(page.props.initialError).toBe(true);
});
