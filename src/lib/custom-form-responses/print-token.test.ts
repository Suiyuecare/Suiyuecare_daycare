import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildDemoFormResponses } from "./demo";
import type { CustomResponsePrintJob } from "./print-contract";
import { issuePrintToken, printTokenConfigured, verifyPrintToken } from "./print-token";

const secret = "synthetic-only-custom-response-print-signing-secret-20260922";
const now = Date.parse("2026-09-22T07:00:00.000Z");
const id = (n: number) => `cf330000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function job(): CustomResponsePrintJob {
  const response = buildDemoFormResponses("2026-09-22").records[0];
  return { jobId: id(1), responseId: response.id, clientId: response.clientId, actorId: id(2), organizationId: id(3), branchId: id(4),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(), snapshotHash: "a".repeat(64), replayed: false,
    snapshot: { response, organizationName: "合成機構", branchName: "合成分支", clientCode: "SYNTHETIC-001", clientName: "合成個案",
      formName: "合成表單", formKey: "tenant.custom.synthetic", formVersion: 1, preparedByName: "合成製表人" } };
}
function expected(source: CustomResponsePrintJob) {
  return { jobId: source.jobId, actorId: source.actorId, organizationId: source.organizationId, branchId: source.branchId };
}
function remac(token: string, change: Record<string, unknown>, macPurpose = "custom_response_pdf.v1") {
  const payload = { ...JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")), ...change };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(`${macPurpose}:${encoded}`).digest("base64url")}`;
}

describe("custom response PDF short-lived actor-bound token", () => {
  beforeEach(() => vi.stubEnv("DOCUMENT_DOWNLOAD_SIGNING_SECRET", secret));
  afterEach(() => vi.unstubAllEnvs());

  it("issues a scoped five-minute token without storing patient answers or names", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    const payload = verifyPrintToken(token, expected(source), now);
    expect(payload).toEqual({ purpose: "custom_response_pdf.v1", ...expected(source), snapshotHash: source.snapshotHash,
      issuedAt: now / 1000, expiresAt: now / 1000 + 300 });
    expect(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).not.toContain("合成");
    expect(issuePrintToken({ ...source, replayed: true }, now + 100_000)).toBe(token);
  });

  it.each(["jobId", "actorId", "organizationId", "branchId"] as const)("rejects the same valid token under another %s", (field) => {
    const source = job();
    expect(() => verifyPrintToken(issuePrintToken(source, now), { ...expected(source), [field]: id(99) }, now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
  });

  it("rejects body/hash substitution without a matching HMAC", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    const [encoded, signature] = token.split(".");
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    body.snapshotHash = "b".repeat(64);
    const changed = Buffer.from(JSON.stringify(body)).toString("base64url");
    expect(() => verifyPrintToken(`${changed}.${signature}`, expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
  });

  it("rejects signature tampering and another signing purpose", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    const [body] = token.split(".");
    expect(() => verifyPrintToken(`${body}.${"a".repeat(43)}`, expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
    expect(() => verifyPrintToken(remac(token, {}, "unrelated-purpose"), expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
    expect(() => verifyPrintToken(remac(token, { purpose: "document_print.v1" }), expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
  });

  it("denies expired tokens exactly at expiry and never extends replayed jobs", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    expect(verifyPrintToken(token, expected(source), now + 299_999).snapshotHash).toBe(source.snapshotHash);
    for (const at of [now + 300_000, now + 300_001, now + 3_600_000]) {
      expect(() => verifyPrintToken(token, expected(source), at)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
      expect(() => issuePrintToken({ ...source, replayed: true }, at)).toThrow("CUSTOM_PRINT_EXPIRED");
    }
  });

  it("rejects future timestamps outside the bounded clock tolerance", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    expect(() => verifyPrintToken(token, expected(source), now - 30_001)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
    expect(() => issuePrintToken(source, now - 30_001)).toThrow("CUSTOM_PRINT_EXPIRED");
    expect(() => verifyPrintToken(token, expected(source), now - 30_000)).not.toThrow();
  });

  it.each([299, 301, 0, -1])("rejects a signed token with %s-second lifetime", (seconds) => {
    const source = job();
    const token = issuePrintToken(source, now);
    expect(() => verifyPrintToken(remac(token, { expiresAt: now / 1000 + seconds }), expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
    expect(() => issuePrintToken({ ...source, expiresAt: new Date(now + seconds * 1000).toISOString() }, now)).toThrow("CUSTOM_PRINT_EXPIRED");
  });

  it("denies tokens issued with a previous secret after secret rotation", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    vi.stubEnv("DOCUMENT_DOWNLOAD_SIGNING_SECRET", "different-synthetic-print-signing-secret-long-enough");
    expect(() => verifyPrintToken(token, expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
  });

  it.each([undefined, "", "   ", "too-short"])("fails closed without a configured secret: %s", (value) => {
    vi.stubEnv("DOCUMENT_DOWNLOAD_SIGNING_SECRET", value);
    expect(printTokenConfigured()).toBe(false);
    expect(() => issuePrintToken(job(), now)).toThrow("CUSTOM_PRINT_SIGNING_NOT_CONFIGURED");
    expect(() => verifyPrintToken("invalid", expected(job()), now)).toThrow("CUSTOM_PRINT_SIGNING_NOT_CONFIGURED");
  });

  it.each(["", ".", "a.b.c", "a.b=", "a.b\n", "a".repeat(2001)])("rejects malformed or oversized tokens", (token) => {
    expect(() => verifyPrintToken(token, expected(job()), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
  });

  it("rejects signed but structurally invalid payloads and extra capabilities", () => {
    const source = job();
    const token = issuePrintToken(source, now);
    for (const change of [{ snapshotHash: "a".repeat(63) }, { actorId: "not-a-uuid" }, { issuedAt: "1" }, { readAllClients: true }]) {
      expect(() => verifyPrintToken(remac(token, change), expected(source), now)).toThrow("CUSTOM_PRINT_TOKEN_INVALID");
    }
  });
});
