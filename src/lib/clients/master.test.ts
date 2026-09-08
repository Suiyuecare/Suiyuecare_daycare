import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoClientMasterSnapshot } from "./master-demo";
import {
  filterClientMasterItems,
  hasClientMasterWriteAuthority,
  parseClientMasterOperationResult,
  parseCreateLocalClient,
  parseUpdateLocalClient,
  projectClientMasterSnapshot,
  type ClientMasterSourceRow,
} from "./master";

const clientId = "60000000-0000-4000-8000-000000000001";
const operationId = "60000000-0000-4000-8000-000000000002";
const idempotencyKey = "60000000-0000-4000-8000-000000000003";
const organizationId = "60000000-0000-4000-8000-000000000004";
const branchId = "60000000-0000-4000-8000-000000000005";
const now = new Date("2026-09-01T04:00:00.000Z");

function createInput() {
  return {
    client_code: " LOCAL-001 ",
    display_name: " 王O安 ",
    date_of_birth: "1948-03-12",
  };
}

function updateInput() {
  return {
    client_id: clientId,
    client_code: "LOCAL-001",
    display_name: "王O安",
    date_of_birth: null,
    expected_row_version: 3,
  };
}

function sourceRow(overrides: Partial<ClientMasterSourceRow> = {}): ClientMasterSourceRow {
  return {
    id: clientId,
    organization_id: organizationId,
    branch_id: branchId,
    client_code: "LOCAL-001",
    display_name: "王O安",
    date_of_birth: "1948-03-12",
    status: "active",
    admitted_on: "2026-01-08",
    ended_on: null,
    source_system: "local",
    source_updated_at: null,
    row_version: 3,
    updated_at: "2026-09-01T03:00:00.000Z",
    ...overrides,
  };
}

describe("client master write contracts", () => {
  it("requires the demographic field permission for the combined form and view-all only for creation", () => {
    const assignedWriter = [
      "clients.read",
      "clients.manage",
      "clients.demographics.read",
    ];
    expect(hasClientMasterWriteAuthority(assignedWriter, "update")).toBe(true);
    expect(hasClientMasterWriteAuthority(assignedWriter, "create")).toBe(false);
    expect(
      hasClientMasterWriteAuthority(
        ["clients.read", "clients.manage", "clients.view_all"],
        "update",
      ),
    ).toBe(false);
    expect(
      hasClientMasterWriteAuthority(
        [...assignedWriter, "clients.view_all"],
        "create",
      ),
    ).toBe(true);
  });

  it("accepts only the three local fields and a UUID retry header", () => {
    expect(parseCreateLocalClient(createInput(), idempotencyKey, now)).toEqual({
      clientCode: "LOCAL-001",
      displayName: "王O安",
      dateOfBirth: "1948-03-12",
      idempotencyKey,
    });
    expect(parseUpdateLocalClient(updateInput(), idempotencyKey, now)).toEqual({
      clientId,
      clientCode: "LOCAL-001",
      displayName: "王O安",
      dateOfBirth: null,
      expectedRowVersion: 3,
      idempotencyKey,
    });
  });

  it("rejects caller-supplied tenant, actor, source, lifecycle, ciphertext, and replay fields", () => {
    for (const field of [
      "organization_id",
      "branch_id",
      "expected_organization_id",
      "expected_branch_id",
      "actor_user_id",
      "created_by",
      "source_system",
      "source_updated_at",
      "external_key",
      "status",
      "admitted_on",
      "ended_on",
      "national_id_ciphertext",
      "row_version",
      "idempotency_key",
    ]) {
      expect(() =>
        parseCreateLocalClient(
          { ...createInput(), [field]: "not-trusted" },
          idempotencyKey,
          now,
        ),
      ).toThrowError(IntegrationError);
      expect(() =>
        parseUpdateLocalClient(
          { ...updateInput(), [field]: "not-trusted" },
          idempotencyKey,
          now,
        ),
      ).toThrowError(IntegrationError);
    }
  });

  it("rejects malformed retry keys, impossible dates, future dates, and unsafe versions", () => {
    expect(() => parseCreateLocalClient(createInput(), "retry", now)).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" }),
    );
    for (const date of ["1948-02-31", "1899-12-31", "2026-09-02"]) {
      expect(() =>
        parseCreateLocalClient(
          { ...createInput(), date_of_birth: date },
          idempotencyKey,
          now,
        ),
      ).toThrowError(IntegrationError);
    }
    expect(() =>
      parseUpdateLocalClient(
        { ...updateInput(), expected_row_version: 0 },
        idempotencyKey,
        now,
      ),
    ).toThrowError(IntegrationError);
  });

  it("validates and binds the immutable database receipt", () => {
    expect(
      parseClientMasterOperationResult(
        {
          operation_id: operationId,
          client_id: clientId,
          row_version: 4,
          replayed: false,
        },
        clientId,
      ),
    ).toEqual({ operationId, clientId, rowVersion: 4, replayed: false });
    expect(() =>
      parseClientMasterOperationResult(
        {
          operation_id: operationId,
          client_id: crypto.randomUUID(),
          row_version: 4,
          replayed: false,
        },
        clientId,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CLIENT_MASTER_RESULT_INVALID" }),
    );
  });
});

describe("client master fail-closed projection", () => {
  it("derives editability from source authority and terminal state", () => {
    const snapshot = projectClientMasterSnapshot({
      rows: [
        sourceRow(),
        sourceRow({
          id: "60000000-0000-4000-8000-000000000006",
          client_code: "CENTRAL-002",
          admitted_on: null,
          source_system: "central_html",
          source_updated_at: "2026-08-31T00:00:00.000Z",
        }),
        sourceRow({
          id: "60000000-0000-4000-8000-000000000007",
          client_code: "LOCAL-003",
          status: "closed",
          ended_on: "2026-08-20",
        }),
      ],
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      generatedAt: "2026-09-01T04:00:00.000Z",
      demo: false,
    });
    expect(snapshot.clients.map((client) => [client.clientCode, client.serviceState, client.editable, client.editBlockReason])).toEqual([
      ["LOCAL-001", "active", true, null],
      ["CENTRAL-002", "pending_admission", false, "central_authority"],
      ["LOCAL-003", "closed", false, "terminal_status"],
    ]);
    expect(snapshot.metrics).toEqual({
      active: 1,
      pendingAdmission: 1,
      localEditable: 1,
      centralAuthority: 1,
      terminal: 1,
    });
    expect(
      filterClientMasterItems(snapshot, {
        query: "",
        status: "pending_admission",
        source: "all",
      }).map((client) => client.clientCode),
    ).toEqual(["CENTRAL-002"]);
  });

  it("rejects cross-tenant, duplicate, malformed, and incomplete terminal rows", () => {
    for (const rows of [
      [sourceRow({ organization_id: crypto.randomUUID() })],
      [sourceRow(), sourceRow()],
      [sourceRow({ row_version: 0 })],
      [sourceRow({ status: "closed", ended_on: null })],
    ]) {
      expect(() =>
        projectClientMasterSnapshot({
          rows,
          expectedOrganizationId: organizationId,
          expectedBranchId: branchId,
          generatedAt: "2026-09-01T04:00:00.000Z",
          demo: false,
        }),
      ).toThrow("INVALID_CLIENT_MASTER_PROJECTION");
    }
  });

  it("fails closed if a non-demographic snapshot unexpectedly contains a DOB", () => {
    expect(() =>
      projectClientMasterSnapshot({
        rows: [sourceRow()],
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        generatedAt: "2026-09-01T04:00:00.000Z",
        demographicsReadable: false,
        demo: false,
      }),
    ).toThrow("INVALID_CLIENT_MASTER_PROJECTION");

    expect(
      projectClientMasterSnapshot({
        rows: [sourceRow({ date_of_birth: null })],
        expectedOrganizationId: organizationId,
        expectedBranchId: branchId,
        generatedAt: "2026-09-01T04:00:00.000Z",
        demographicsReadable: false,
        demo: false,
      }).clients[0]?.dateOfBirth,
    ).toBeNull();
  });

  it("filters the synthetic demo without mutating it and marks it non-persistent", () => {
    const snapshot = buildDemoClientMasterSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(
      filterClientMasterItems(snapshot, {
        query: "LOCAL",
        status: "active",
        source: "local",
      }).map((client) => client.clientCode),
    ).toEqual(["LOCAL-022"]);
    expect(snapshot.clients).toHaveLength(4);
  });
});
