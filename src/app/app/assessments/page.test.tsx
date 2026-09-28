import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context }));
vi.mock("@/lib/clients/master-snapshot", () => ({
  ClientMasterSnapshotError: class ClientMasterSnapshotError extends Error {},
  loadClientMasterSnapshot: mocks.load,
}));
vi.mock("@/lib/api/server-read-deadline", () => ({
  withServerReadDeadline: (read: (signal: AbortSignal) => Promise<unknown>) => read(new AbortController().signal),
}));
vi.mock("@/components/assessments/assessment-entry-workspace", () => ({ AssessmentEntryWorkspace: () => null }));

import AssessmentEntryPage from "./page";
import { buildDemoCaseCenterSnapshot } from "@/lib/case-center/demo";

const ownClient = "c1600000-0000-4000-8000-000000000001";
const otherClient = "c1600000-0000-4000-8000-000000000002";
const terminalClient = "c1600000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ demo: false, scopes: ["clients.read", "questionnaire_cognition.read"] });
  mocks.load.mockResolvedValue({ clients: [
    { id: ownClient, status: "active" },
    { id: terminalClient, status: "closed" },
  ] });
});

it("checks the current authorized client snapshot before accepting a deep link", async () => {
  const page = await AssessmentEntryPage({ searchParams: Promise.resolve({ client: ownClient }) });
  expect(mocks.context).toHaveBeenCalledWith("staff");
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ scopes: ["clients.read", "questionnaire_cognition.read"] }), "view", { signal: expect.any(AbortSignal) });
  expect(page.props.selectedClientId).toBe(ownClient);
  expect(page.props.selectionRejected).toBe(false);
  expect(page.props.clients.map((client: { id: string }) => client.id)).toEqual([ownClient]);
  expect(page.props.pages.map((item: { number: number }) => item.number)).toEqual([11]);
});

it.each([otherClient, terminalClient, "not-a-client", [ownClient, otherClient]])(
  "rejects a missing, terminal, malformed, or multi-valued requested client %j",
  async (requested) => {
    const page = await AssessmentEntryPage({ searchParams: Promise.resolve({ client: requested }) });
    expect(page.props.selectedClientId).toBeNull();
    expect(page.props.selectionRejected).toBe(true);
    expect(page.props.clients.map((client: { id: string }) => client.id)).toEqual([ownClient]);
  },
);

it("does not read or display client data without any authorized assessment page", async () => {
  mocks.context.mockResolvedValue({ demo: false, scopes: ["clients.read"] });
  const page = await AssessmentEntryPage({ searchParams: Promise.resolve({ client: ownClient }) });
  expect(page.props.role).toBe("alert");
  expect(mocks.load).not.toHaveBeenCalled();
});

it("keeps a Case Center demonstration client selected through the assessment entry", async () => {
  const caseCenter = buildDemoCaseCenterSnapshot({
    date: "2026-09-28",
    query: "DEMO-010",
    lifecycle: "all",
    service: "all",
    responsible: "all",
    page: 1,
  });
  const chosen = caseCenter.clients[0];
  expect(chosen).toMatchObject({
    id: "0000000a-aaaa-4aaa-8aaa-00000000000a",
    clientCode: "DEMO-010",
  });
  mocks.context.mockResolvedValue({ demo: true, scopes: ["clients.read", "questionnaire_cognition.read"] });

  const page = await AssessmentEntryPage({ searchParams: Promise.resolve({ client: chosen!.id }) });
  expect(page.props.selectedClientId).toBe(chosen!.id);
  expect(page.props.selectionRejected).toBe(false);
  expect(page.props.clients).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: chosen!.id, clientCode: chosen!.clientCode, displayName: chosen!.displayName }),
  ]));
  expect(mocks.load).not.toHaveBeenCalled();

  const closedId = "0000000d-aaaa-4aaa-8aaa-00000000000d";
  const closedPage = await AssessmentEntryPage({ searchParams: Promise.resolve({ client: closedId }) });
  expect(closedPage.props.clients.some((client: { id: string }) => client.id === closedId)).toBe(false);
  expect(closedPage.props.selectedClientId).toBeNull();
  expect(closedPage.props.selectionRejected).toBe(true);
});
