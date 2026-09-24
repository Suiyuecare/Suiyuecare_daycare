import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const tls = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:tls", async () => ({ ...await vi.importActual("node:tls"), connect: tls.connect }));
import { awsRead, CLEAN_PROBE, EICAR_PROBE, inspectConfiguration, inspectInfrastructure, tlsProbe, verifyArchiveMetadata, verifyScannerResponses } from "./preflight.mjs";

const now = new Date("2026-09-14T03:00:00Z");
const config = {
  AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "synthetic-intake-archive", AWS_KMS_KEY_ID: "arn:aws:kms:ap-northeast-1:123456789012:key/00000000-0000-4000-8000-000000000001",
  CLIENT_DOCUMENTS_CLAMAV_HOST: "scanner.example.invalid", CLIENT_DOCUMENTS_SCANNER_APPROVED: "true", CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE: "private_network",
  INTAKE_PREFLIGHT_CANARY_KEY: "healthchecks/intake/synthetic.html", INTAKE_PREFLIGHT_CANARY_VERSION: "synthetic-version-1", INTAKE_PREFLIGHT_CANARY_SHA256: "a".repeat(64), INTAKE_PREFLIGHT_CANARY_CREATED_AT: "2026-09-14T00:00:00Z",
};
function archive() {
  return { identity: { Account: "123456789012" }, location: { LocationConstraint: "ap-northeast-1" }, versioning: { Status: "Enabled" }, lock: { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Years: 7 } } } }, publicAccess: { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }, policyStatus: { PolicyStatus: { IsPublic: false } }, encryption: { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: config.AWS_KMS_KEY_ID } }] } }, kms: { KeyMetadata: { Arn: config.AWS_KMS_KEY_ID, KeyState: "Enabled", Enabled: true, KeyUsage: "ENCRYPT_DECRYPT", KeySpec: "SYMMETRIC_DEFAULT" } }, canary: { VersionId: config.INTAKE_PREFLIGHT_CANARY_VERSION, ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: "2033-09-14T00:00:00Z", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.AWS_KMS_KEY_ID, ChecksumSHA256: Buffer.from(config.INTAKE_PREFLIGHT_CANARY_SHA256, "hex").toString("base64"), ChecksumType: "FULL_OBJECT", ContentLength: 100, Metadata: { data_classification: "synthetic-intake-preflight", sha256: config.INTAKE_PREFLIGHT_CANARY_SHA256 } } };
}
const scannerResponses = () => ({ ping: "PONG\0", version: "ClamAV 1.4.3/28000/Mon Sep 14 00:00:00 2026 UTC\0", clean: "stream: OK\0", eicar: "stream: Win.Test.EICAR_HDB-1 FOUND\0" });
function liveDependencies() {
  const data = archive();
  const fields = { "get-caller-identity": "identity", "get-bucket-location": "location", "get-bucket-versioning": "versioning", "get-object-lock-configuration": "lock", "get-public-access-block": "publicAccess", "get-bucket-policy-status": "policyStatus", "get-bucket-encryption": "encryption", "describe-key": "kms", "head-object": "canary" };
  return { live: true, now, aws: vi.fn((command) => data[fields[command[1]]]), scanner: vi.fn(async (_env, command, bytes) => scannerResponses()[command === "PING" ? "ping" : command === "VERSION" ? "version" : bytes.equals(CLEAN_PROBE) ? "clean" : "eicar"]) };
}

describe("intake infrastructure fail-closed preflight", () => {
  it("does not touch network with missing configuration", async () => {
    const dependencies = liveDependencies(); const report = await inspectInfrastructure({}, dependencies);
    expect(report.configuration.valid).toBe(false); expect(report.operatorEnablementRecommended).toBe(false);
    expect(dependencies.aws).not.toHaveBeenCalled(); expect(dependencies.scanner).not.toHaveBeenCalled();
  });
  it("configuration-only mode never establishes readiness or makes network calls", async () => {
    const dependencies = liveDependencies(); const report = await inspectInfrastructure(config, { ...dependencies, live: false });
    expect(report.configuration.valid).toBe(true); expect(report.operatorEnablementRecommended).toBe(false); expect(dependencies.aws).not.toHaveBeenCalled();
  });
  it.each([
    { AWS_REGION: "ap-northeast-2" }, { HTML_ARCHIVE_BUCKET: "wrong..bucket" }, { AWS_KMS_KEY_ID: "alias/test" }, { CLIENT_DOCUMENTS_CLAMAV_HOST: "http://scanner.invalid" }, { CLIENT_DOCUMENTS_CLAMAV_PORT: "70000" },
    { CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE: undefined }, { CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE: "public_anonymous" }, { CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE: "mtls" },
    { CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE: "mtls", CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM: "not-a-certificate", CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM: "not-a-key" },
    { CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM: "unexpected" }, { AWS_ENDPOINT_URL_S3: "https://external.invalid" },
    { CLIENT_DOCUMENTS_CLAMAV_CA_PEM: "not-a-certificate" }, { CLIENT_DOCUMENTS_CLAMAV_CA_PEM: "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----" },
    { CLIENT_DOCUMENTS_CLAMAV_CA_PEM: "x".repeat(32769) },
  ])("rejects unsafe config %j", (overrides) => expect(inspectConfiguration({ ...config, ...overrides }).valid).toBe(false));
  it("validates real-response-shaped archive evidence without treating unit mocks as live evidence", () => expect(verifyArchiveMetadata(archive(), config, now)).toEqual({ verified: true, problems: [] }));
  it.each([
    ["location", { LocationConstraint: "ap-northeast-2" }], ["versioning", { Status: "Suspended" }], ["identity", { Account: "222222222222" }], ["policyStatus", { PolicyStatus: { IsPublic: true } }], ["canary", null], ["kms", { KeyMetadata: { ...archive().kms.KeyMetadata, KeyState: "PendingDeletion" } }], ["lock", { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "GOVERNANCE", Years: 7 } } } }],
  ])("rejects invalid archive evidence %s", (field, value) => expect(verifyArchiveMetadata({ ...archive(), [field]: value }, config, now).verified).toBe(false));
  it.each([{ ObjectLockRetainUntilDate: "2032-09-14T00:00:00Z" }, { VersionId: "null" }, { ServerSideEncryption: "AES256" }, { ContentLength: undefined }, { ChecksumType: "COMPOSITE" }, { ChecksumSHA256: "wrong" }, { Metadata: { data_classification: "sensitive-central-html" } }])("rejects incomplete or unsafe canary %j", (override) => {
    const data = archive(); data.canary = { ...data.canary, ...override }; expect(verifyArchiveMetadata(data, config, now).verified).toBe(false);
  });
  it("requires fresh signatures and negative/positive scanner controls", () => {
    expect(verifyScannerResponses(scannerResponses(), now).verified).toBe(true);
    for (const override of [{ ping: "OK" }, { version: "ClamAV 1.4.3/27000/Mon Sep 01 00:00:00 2025 UTC\0" }, { clean: "stream: limit exceeded ERROR\0" }, { eicar: "stream: OK\0" }]) expect(verifyScannerResponses({ ...scannerResponses(), ...override }, now).verified).toBe(false);
  });
  it("only recommends enablement after every infrastructure and governance gate", async () => {
    const dependencies = liveDependencies(); const report = await inspectInfrastructure(config, dependencies);
    expect(report.operatorEnablementRecommended).toBe(true); expect(dependencies.aws).toHaveBeenCalledTimes(9); expect(dependencies.scanner).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(report)).not.toContain(config.HTML_ARCHIVE_BUCKET); expect(JSON.stringify(report)).not.toContain(config.AWS_KMS_KEY_ID);
    expect(JSON.stringify(report)).not.toContain(config.CLIENT_DOCUMENTS_CLAMAV_HOST);
    expect((await inspectInfrastructure({ ...config, CLIENT_DOCUMENTS_SCANNER_APPROVED: "false" }, liveDependencies())).operatorEnablementRecommended).toBe(false);
  });
  it("sanitizes arbitrary secret-bearing external errors", async () => {
    const report = await inspectInfrastructure(config, { live: true, now, aws: () => { throw new Error("secret-access-token do-not-log"); }, scanner: async () => { throw new Error("credential-host-do-not-log"); } });
    expect(report.operatorEnablementRecommended).toBe(false); expect(JSON.stringify(report)).not.toContain("do-not-log");
  });
  it("never accepts write/provision commands in the AWS adapter", () => {
    expect(() => awsRead(["s3api", "put-object"])).toThrow("AWS_READ_ONLY_COMMAND_REQUIRED");
    expect(() => awsRead(["kms", "create-key"])).toThrow("AWS_READ_ONLY_COMMAND_REQUIRED");
  });
  it("only probes a scoped synthetic key, not uploaded client paths", async () => {
    const dependencies = liveDependencies(); const report = await inspectInfrastructure({ ...config, INTAKE_PREFLIGHT_CANARY_KEY: "organizations/private-client.html" }, dependencies);
    expect(report.archive.verified).toBe(false); expect(dependencies.aws.mock.calls.some(([command]) => command[1] === "head-object")).toBe(false);
  });
  it("uses tiny in-memory controls without any real client file", () => {
    expect(EICAR_PROBE.length).toBe(68); expect(CLEAN_PROBE.length).toBeLessThan(200);
  });
  it("does not transmit arbitrary file bytes or mutation commands to a scanner", async () => {
    await expect(tlsProbe(config, "SHUTDOWN")).rejects.toThrow("SCANNER_SYNTHETIC_PROBE_REQUIRED");
    await expect(tlsProbe(config, "INSTREAM", Buffer.from("arbitrary attachment"))).rejects.toThrow("SCANNER_SYNTHETIC_PROBE_REQUIRED");
  });
});

describe("synthetic scanner probe total deadline", () => {
  class Socket extends EventEmitter {
    authorized = true; destroy = vi.fn(); write = vi.fn(); setTimeout = vi.fn();
  }
  let socket;
  beforeEach(() => { vi.useFakeTimers(); socket = new Socket(); tls.connect.mockReturnValue(socket); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  it("rejects after 12 seconds despite partial responses resetting idle activity", async () => {
    const result = tlsProbe(config, "PING").catch(error => error);
    socket.emit("secureConnect");
    await vi.advanceTimersByTimeAsync(5000); socket.emit("data", Buffer.from("PO"));
    await vi.advanceTimersByTimeAsync(5000); socket.emit("data", Buffer.from("N"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ message: "SCANNER_TLS_OR_CONNECTIVITY_FAILED" });
    expect(socket.destroy).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    socket.emit("data", Buffer.from("G\0")); expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it("bounds a stalled handshake and sends no control bytes after expiry", async () => {
    const result = tlsProbe(config, "INSTREAM", CLEAN_PROBE).catch(error => error);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toMatchObject({ message: "SCANNER_TLS_OR_CONNECTIVITY_FAILED" });
    socket.emit("secureConnect"); expect(socket.write).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("clears the total deadline after a complete response", async () => {
    const result = tlsProbe(config, "PING"); socket.emit("secureConnect"); socket.emit("data", Buffer.from("PONG\0"));
    expect(await result).toBe("PONG\0"); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(12000); expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it("clears the total deadline after a transport error without exposing its detail", async () => {
    const result = tlsProbe(config, "PING").catch(error => error); socket.emit("error", new Error("synthetic-private-tls-detail"));
    expect(await result).toMatchObject({ message: "SCANNER_TLS_OR_CONNECTIVITY_FAILED" }); expect(vi.getTimerCount()).toBe(0);
  });
});
