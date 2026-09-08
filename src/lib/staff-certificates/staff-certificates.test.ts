import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoStaffCertificateSnapshot } from "./demo";
import {
  parseStaffCertificateExceptionApiEnvelope,
  parseStaffCertificateExceptionInput,
  parseStaffCertificateRecordApiEnvelope,
  parseStaffCertificateRecordInput,
} from "./parser";

const ORG = "72000000-0000-4000-8000-000000000001";
const BRANCH = "72000000-0000-4000-8000-000000000002";
const STAFF = "72040000-0000-4000-8000-000000000001";
const KEY = "72000000-0000-4000-8000-000000000005";
const CERT = "72071000-0000-4000-8000-000000000005";
const VERSION = "72070000-0000-4000-8000-000000000005";
const REQUEST = "72080000-0000-4000-8000-000000000005";
const APPROVAL = "72090000-0000-4000-8000-000000000005";
const filters = { staffMembershipId: null, certificateType: null,
  status: "all" as const, query: "" };

const createBody = {
  action: "create", certificate_key: CERT, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  certificate_type: "合成證照", certificate_number: "SYNTH-001",
  effective_on: "2026-01-01", expires_on: "2027-01-01",
  registration_status: "registered", verification_status: "verified",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null,
};

describe("page-72 staff certificate contracts", () => {
  it("builds a read-only synthetic snapshot without inventing policies", () => {
    const snapshot = buildDemoStaffCertificateSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.expiryReminderPolicyStatus).toBe("not_configured");
    expect(snapshot.expiringTotal).toBeNull();
    expect(snapshot.restrictedServicePolicyStatus).toBe("not_configured");
    expect(snapshot.records.every((record) =>
      record.serviceEligibilityStatus === "not_evaluated")).toBe(true);
  });

  it("filters synthetic records while keeping exact filtered totals", () => {
    const snapshot = buildDemoStaffCertificateSnapshot({
      organizationId: ORG, branchId: BRANCH,
      filters: { ...filters, status: "expired" },
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.recordTotal).toBe(1);
    expect(snapshot.expiredTotal).toBe(1);
    expect(snapshot.records[0]?.hasActiveException).toBe(true);
  });

  it("parses strict create and correction version contracts", () => {
    const created = parseStaffCertificateRecordInput(createBody, KEY);
    expect(created).toMatchObject({ action: "create", expectedBaseVersion: 0,
      evidenceStatus: "missing", attachmentReference: null });
    const corrected = parseStaffCertificateRecordInput({ ...createBody,
      action: "correct", previous_version_id: VERSION, expected_base_version: 1,
      correction_reason: "修正到期日" }, KEY);
    expect(corrected).toMatchObject({ action: "correct", previousVersionId: VERSION,
      expectedBaseVersion: 1 });
  });

  it.each([
    { ...createBody, expires_on: "2025-12-31" },
    { ...createBody, attachment_reference: "browser://fake" },
    { ...createBody, evidence_status: "provided", attachment_reference: "browser://fake",
      attachment_sha256: "a".repeat(64) },
    { ...createBody, unexpected: "field" },
  ])("rejects invalid dates, untrusted attachments and extra fields %#", (body) => {
    expect(() => parseStaffCertificateRecordInput(body, KEY)).toThrow(IntegrationError);
  });

  it("correlates the persisted record receipt to tenant, version and target", () => {
    const input = parseStaffCertificateRecordInput(createBody, KEY);
    const payload = { requestId: REQUEST, status: "ok", data: { receipt: {
      organizationId: ORG, branchId: BRANCH, certificateKey: CERT,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", staffMembershipId: STAFF,
      contentHash: "a".repeat(64), recordedAt: "2026-09-02T04:00:00.000Z",
      replayed: false, persisted: true, demo: false,
    }, persisted: true, demo: false }, errors: [] };
    expect(parseStaffCertificateRecordApiEnvelope(payload, input, ORG, BRANCH, 201))
      .toMatchObject({ certificateKey: CERT, version: 1, persisted: true });
    expect(() => parseStaffCertificateRecordApiEnvelope({ ...payload,
      data: { ...payload.data, receipt: { ...payload.data.receipt, branchId: ORG } },
    }, input, ORG, BRANCH, 201)).toThrow(IntegrationError);
    expect(() => parseStaffCertificateRecordApiEnvelope(
      payload, input, ORG, BRANCH, 200,
    )).toThrow(IntegrationError);
  });

  it("requires a finite exception period and stable certificate version", () => {
    const input = parseStaffCertificateExceptionInput({ action: "request",
      certificate_key: CERT, certificate_version_id: VERSION,
      expected_certificate_version: 1, valid_from: "2026-09-02",
      valid_through: "2026-09-30", reason: "有限期間人力調整" }, KEY);
    expect(input).toMatchObject({ action: "request", expectedCertificateVersion: 1,
      validThrough: "2026-09-30" });
    expect(() => parseStaffCertificateExceptionInput({ action: "request",
      certificate_key: CERT, certificate_version_id: VERSION,
      expected_certificate_version: 1, valid_from: "2026-10-01",
      valid_through: "2026-09-30", reason: "錯誤期間" }, KEY)).toThrow(IntegrationError);
  });

  it("correlates first and second independent approval receipts exactly", () => {
    const input = parseStaffCertificateExceptionInput({ action: "approve",
      request_id: REQUEST, certificate_key: CERT, certificate_version_id: VERSION,
      expected_certificate_version: 1, expected_approval_count: 1 }, KEY);
    const payload = { requestId: "72000000-0000-4000-8000-000000000099",
      status: "ok", data: { receipt: {
        organizationId: ORG, branchId: BRANCH, action: "approve", requestId: REQUEST,
        certificateKey: CERT, certificateVersionId: VERSION,
        expectedCertificateVersion: 1, approvalId: APPROVAL, approvalCount: 2,
        exceptionStatus: "approved", validFrom: "2026-09-02",
        validThrough: "2026-09-30", committedAt: "2026-09-02T04:00:00.000Z",
        replayed: false, persisted: true, demo: false,
      }, persisted: true, demo: false }, errors: [] };
    expect(parseStaffCertificateExceptionApiEnvelope(payload, input, ORG, BRANCH, 201))
      .toMatchObject({ approvalCount: 2, exceptionStatus: "approved" });
    expect(() => parseStaffCertificateExceptionApiEnvelope({ ...payload,
      data: { ...payload.data, receipt: { ...payload.data.receipt, approvalCount: 1 } },
    }, input, ORG, BRANCH, 201)).toThrow(IntegrationError);
    expect(() => parseStaffCertificateExceptionApiEnvelope(
      payload, input, ORG, BRANCH, 200,
    )).toThrow(IntegrationError);
  });
});
