import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoFormGovernanceSnapshot } from "./demo";
import {
  parseFormPublicationApproval,
  parseFormPublicationApprovalResult,
  parseFormPublicationActionError,
  parseFormPublicationActionSuccess,
  parseFormPublicationRequest,
  parseFormPublicationRequestResult,
} from "./parser";
import {
  filterFormGovernanceVersions,
  projectFormGovernanceSnapshot,
  type FormDefinitionSourceRow,
  type FormVersionSourceRow,
} from "./projection";

const versionId = "82100000-0000-4000-8000-000000000001";
const requestId = "82200000-0000-4000-8000-000000000001";
const idempotencyKey = "82500000-0000-4000-8000-000000000001";

describe("form publication parsers", () => {
  it("accepts only a strict target and UUID Idempotency-Key", () => {
    expect(
      parseFormPublicationRequest(
        { form_version_id: versionId },
        idempotencyKey,
      ),
    ).toEqual({ formVersionId: versionId, idempotencyKey });
    expect(
      parseFormPublicationApproval({ request_id: requestId }, idempotencyKey),
    ).toEqual({ requestId, idempotencyKey });
    expect(() =>
      parseFormPublicationRequest(
        { form_version_id: versionId, organization_id: crypto.randomUUID() },
        idempotencyKey,
      ),
    ).toThrow(IntegrationError);
    expect(() =>
      parseFormPublicationApproval({ request_id: requestId }, "retry-token"),
    ).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" }),
    );
  });

  it("rejects malformed or mismatched database receipts", () => {
    expect(
      parseFormPublicationRequestResult({
        request_id: requestId,
        status: "pending",
        form_content_hash: "a".repeat(64),
        replayed: false,
      }),
    ).toMatchObject({ requestId, status: "pending", replayed: false });
    expect(() =>
      parseFormPublicationRequestResult({
        request_id: requestId,
        status: "approved",
        form_content_hash: "a".repeat(64),
        replayed: false,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "FORM_PUBLICATION_RESULT_INVALID" }),
    );
    expect(() =>
      parseFormPublicationApprovalResult(
        {
          request_id: crypto.randomUUID(),
          form_version_id: versionId,
          status: "approved",
          published_at: "2026-09-01T08:00:00.000Z",
          replayed: false,
        },
        requestId,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "FORM_PUBLICATION_RESULT_INVALID" }),
    );
  });

  it("accepts only an exact request action envelope correlated to the selected version", () => {
    const value = {
      requestId: "82600000-0000-4000-8000-000000000001",
      status: "ok",
      data: {
        publication: {
          requestId,
          formVersionId: versionId,
          status: "pending",
          formContentHash: "a".repeat(64),
        },
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(
      parseFormPublicationActionSuccess(value, {
        kind: "request",
        formVersionId: versionId,
        httpStatus: 201,
      }),
    ).toMatchObject({ data: { publication: { formVersionId: versionId } } });
    expect(() =>
      parseFormPublicationActionSuccess(
        {
          ...value,
          data: {
            ...value.data,
            publication: {
              ...value.data.publication,
              formVersionId: crypto.randomUUID(),
            },
          },
        },
        { kind: "request", formVersionId: versionId, httpStatus: 201 },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "FORM_PUBLICATION_RESULT_INVALID" }),
    );
    expect(() =>
      parseFormPublicationActionSuccess(
        { ...value, extra: true },
        { kind: "request", formVersionId: versionId, httpStatus: 201 },
      ),
    ).toThrow(IntegrationError);
  });

  it("correlates approval identity, version, timestamp, replay, and HTTP state", () => {
    const value = {
      requestId: "82600000-0000-4000-8000-000000000002",
      status: "ok",
      data: {
        publication: {
          requestId,
          formVersionId: versionId,
          status: "approved",
          publishedAt: "2026-09-01T08:00:00+08:00",
        },
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(
      parseFormPublicationActionSuccess(value, {
        kind: "approve",
        formVersionId: versionId,
        publicationRequestId: requestId,
        httpStatus: 201,
      }),
    ).toMatchObject({
      data: { publication: { publishedAt: "2026-09-01T00:00:00.000Z" } },
    });
    expect(() =>
      parseFormPublicationActionSuccess(
        {
          ...value,
          data: {
            ...value.data,
            publication: { ...value.data.publication, publishedAt: "tomorrow" },
          },
        },
        {
          kind: "approve",
          formVersionId: versionId,
          publicationRequestId: requestId,
          httpStatus: 201,
        },
      ),
    ).toThrow(IntegrationError);
    expect(() =>
      parseFormPublicationActionSuccess(value, {
        kind: "approve",
        formVersionId: versionId,
        publicationRequestId: requestId,
        httpStatus: 200,
      }),
    ).toThrow(IntegrationError);
  });

  it("uses only a strict error envelope for user-visible API messages", () => {
    expect(
      parseFormPublicationActionError({
        requestId: "82600000-0000-4000-8000-000000000003",
        status: "error",
        data: null,
        errors: [{ code: "DEMO_READ_ONLY", message: "展示模式唯讀" }],
      })?.errors[0]?.message,
    ).toBe("展示模式唯讀");
    expect(
      parseFormPublicationActionError({
        requestId: "not-a-uuid",
        status: "error",
        data: null,
        errors: [{ code: "ERROR", message: "不可信內容" }],
      }),
    ).toBeNull();
  });
});

describe("form governance projection", () => {
  it("projects tenant and official versions with server-derived metrics", () => {
    const snapshot = buildDemoFormGovernanceSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.metrics).toEqual({
      active: 1,
      drafts: 4,
      pending: 2,
      upcoming: 0,
      overlapWarnings: 0,
    });
    expect(snapshot.versions.find((row) => row.id.endsWith("0002")))
      .toMatchObject({
        official: false,
        schemaFieldCount: 4,
        publication: {
          status: "pending",
          requestedByCurrentUser: false,
        },
      });
  });

  it("filters without changing the source snapshot", () => {
    const snapshot = buildDemoFormGovernanceSnapshot();
    const filtered = filterFormGovernanceVersions(snapshot, {
      query: "照顧日誌",
      status: "pending",
      scope: "tenant",
      category: "all",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ version: 2, status: "draft" });
    expect(snapshot.versions).toHaveLength(6);
  });

  it("fails closed when rows escape tenant scope or published evidence is incomplete", () => {
    const definition: FormDefinitionSourceRow = {
      id: "82000000-0000-4000-8000-000000000009",
      organization_id: "99999999-9999-4999-8999-999999999999",
      form_key: "tenant.invalid",
      name: "跨機構資料",
      category: "測試",
      is_official: false,
    };
    const version: FormVersionSourceRow = {
      id: "82100000-0000-4000-8000-000000000009",
      form_definition_id: definition.id,
      version: 1,
      status: "published",
      effective_from: "2026-01-01",
      effective_to: null,
      schema_field_count: 0,
      scoring_rule_count: 0,
      published_at: null,
      content_hash: null,
    };
    expect(() =>
      projectFormGovernanceSnapshot({
        definitionRows: [definition],
        versionRows: [version],
        publicationRows: [],
        expectedOrganizationId: "11111111-1111-4111-8111-111111111111",
        expectedBranchId: "22222222-2222-4222-8222-222222222222",
        today: "2026-09-01",
        generatedAt: "2026-09-01T00:00:00.000Z",
        demo: false,
      }),
    ).toThrow("INVALID_FORM_GOVERNANCE_PROJECTION");
  });
});
