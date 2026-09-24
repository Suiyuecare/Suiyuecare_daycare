import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { connect, createSecureContext } from "node:tls";

export const CLEAN_PROBE = Buffer.from("Suiyue intake scanner synthetic connectivity probe. No personal data.\n");
// Standard harmless anti-virus test signature, constructed only in memory.
export const EICAR_PROBE = Buffer.from("WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=", "base64");
const REGION = "ap-northeast-1";
const inputPresent = (value) => typeof value === "string" && value.length > 0;

export function inspectConfiguration(env) {
  const required = ["AWS_REGION", "HTML_ARCHIVE_BUCKET", "AWS_KMS_KEY_ID", "CLIENT_DOCUMENTS_CLAMAV_HOST", "CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE"];
  const missing = required.filter((name) => !inputPresent(env[name]));
  const problems = [];
  if (env.AWS_REGION && env.AWS_REGION !== REGION) problems.push("ARCHIVE_REGION_MUST_BE_TOKYO");
  if (env.HTML_ARCHIVE_BUCKET && (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.HTML_ARCHIVE_BUCKET) || env.HTML_ARCHIVE_BUCKET.includes(".."))) problems.push("ARCHIVE_BUCKET_INVALID");
  if (env.AWS_KMS_KEY_ID && !/^arn:aws:kms:ap-northeast-1:\d{12}:key\/[a-zA-Z0-9-]+$/.test(env.AWS_KMS_KEY_ID)) problems.push("ARCHIVE_KMS_ARN_INVALID");
  if (env.CLIENT_DOCUMENTS_CLAMAV_HOST && (!/^(?=.{1,253}$)[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/.test(env.CLIENT_DOCUMENTS_CLAMAV_HOST))) problems.push("SCANNER_HOST_INVALID");
  const port = Number(env.CLIENT_DOCUMENTS_CLAMAV_PORT ?? "3310");
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SCANNER_PORT_INVALID");
  if (Object.keys(env).some((name) => name.startsWith("AWS_ENDPOINT_URL") && env[name])) problems.push("AWS_ENDPOINT_OVERRIDES_NOT_ALLOWED");
  const mode = env.CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE;
  const cert = env.CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM;
  const key = env.CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM;
  const ca = env.CLIENT_DOCUMENTS_CLAMAV_CA_PEM;
  if (mode && mode !== "mtls" && mode !== "private_network") problems.push("SCANNER_ACCESS_MODE_INVALID");
  if ((mode === "mtls" && (!cert || !key)) || (mode === "private_network" && (cert || key))) problems.push("SCANNER_CLIENT_IDENTITY_INVALID");
  if ([cert, key, ca].some((value) => value && (typeof value !== "string" || value.length > 32768))) problems.push("SCANNER_TLS_MATERIAL_INVALID");
  else if (cert || key || ca) {
    try {
      // Node can silently accept an invalid CA string; parse each actual CA
      // certificate, then reject any unparsed content before opening a socket.
      if (ca) {
        const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
        if (!certificates.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()) throw new Error("INVALID_CA");
        for (const certificate of certificates) new X509Certificate(certificate);
      }
      createSecureContext({ ...(cert ? { cert } : {}), ...(key ? { key } : {}), ...(ca ? { ca } : {}), minVersion: "TLSv1.2" });
    }
    catch { problems.push("SCANNER_TLS_MATERIAL_INVALID"); }
  }
  return { valid: missing.length === 0 && problems.length === 0, missing, problems };
}

export function verifyArchiveMetadata(data, config, now = new Date()) {
  const problems = [];
  const key = data.kms?.KeyMetadata;
  const kmsAccount = config.AWS_KMS_KEY_ID.split(":")[4];
  if (!/^\d{12}$/.test(data.identity?.Account ?? "") || data.identity.Account !== kmsAccount) problems.push("AWS_COMPANY_ACCOUNT_MISMATCH");
  if (data.location?.LocationConstraint !== REGION) problems.push("BUCKET_ACTUAL_REGION_MISMATCH");
  if (data.versioning?.Status !== "Enabled") problems.push("BUCKET_VERSIONING_REQUIRED");
  const lock = data.lock?.ObjectLockConfiguration;
  if (lock?.ObjectLockEnabled !== "Enabled" || lock.Rule?.DefaultRetention?.Mode !== "COMPLIANCE" || lock.Rule.DefaultRetention.Years !== 7) problems.push("SEVEN_YEAR_COMPLIANCE_DEFAULT_REQUIRED");
  const block = data.publicAccess?.PublicAccessBlockConfiguration;
  if (!["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"].every((name) => block?.[name] === true) || data.policyStatus?.PolicyStatus?.IsPublic !== false) problems.push("PUBLIC_ACCESS_NOT_FULLY_BLOCKED");
  const encryption = data.encryption?.ServerSideEncryptionConfiguration?.Rules;
  if (!Array.isArray(encryption) || !encryption.some((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === "aws:kms" && rule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID === config.AWS_KMS_KEY_ID)) problems.push("BUCKET_KMS_ENCRYPTION_MISMATCH");
  if (key?.Arn !== config.AWS_KMS_KEY_ID || key?.KeyState !== "Enabled" || key?.Enabled !== true || key?.KeyUsage !== "ENCRYPT_DECRYPT" || key?.KeySpec !== "SYMMETRIC_DEFAULT" || key?.DeletionDate) problems.push("KMS_KEY_NOT_READY");
  const probe = data.canary;
  const created = new Date(config.INTAKE_PREFLIGHT_CANARY_CREATED_AT ?? "");
  const retention = new Date(created);
  retention.setUTCFullYear(retention.getUTCFullYear() + 7);
  if (!probe) problems.push("EXISTING_SYNTHETIC_CANARY_EVIDENCE_REQUIRED");
  else if (!Number.isFinite(created.getTime()) || created > now || probe.VersionId !== config.INTAKE_PREFLIGHT_CANARY_VERSION || probe.VersionId === "null" || probe.DeleteMarker === true || probe.ObjectLockMode !== "COMPLIANCE" || new Date(probe.ObjectLockRetainUntilDate) < retention || !Number.isFinite(new Date(probe.ObjectLockRetainUntilDate).getTime()) || new Date(probe.ObjectLockRetainUntilDate) <= now || probe.ServerSideEncryption !== "aws:kms" || probe.SSEKMSKeyId !== config.AWS_KMS_KEY_ID || probe.ChecksumSHA256 !== Buffer.from(config.INTAKE_PREFLIGHT_CANARY_SHA256 ?? "", "hex").toString("base64") || probe.ChecksumType !== "FULL_OBJECT" || !Number.isSafeInteger(probe.ContentLength) || probe.ContentLength < 1 || probe.ContentLength > 4096 || probe.Metadata?.data_classification !== "synthetic-intake-preflight" || probe.Metadata?.sha256 !== config.INTAKE_PREFLIGHT_CANARY_SHA256) problems.push("CANARY_RETENTION_ENCRYPTION_OR_CHECKSUM_INVALID");
  return { verified: problems.length === 0, problems };
}

export function verifyScannerResponses(responses, now = new Date()) {
  const problems = [];
  if (!/^PONG[\0\r\n]*$/.test(responses.ping ?? "")) problems.push("SCANNER_PING_FAILED");
  const version = (responses.version ?? "").trim().replace(/\0+$/, "").match(/^ClamAV ([^/\s]+)\/(\d+)\/(.+)$/);
  const signaturesAt = version ? new Date(version[3]) : new Date(NaN);
  if (!version || !Number.isFinite(signaturesAt.getTime()) || now.getTime() - signaturesAt.getTime() > 48 * 3600_000 || signaturesAt.getTime() - now.getTime() > 3600_000) problems.push("SCANNER_SIGNATURE_DATABASE_NOT_FRESH");
  if (!/^stream: OK[\0\r\n]*$/.test(responses.clean ?? "")) problems.push("SCANNER_CLEAN_CONTROL_FAILED");
  if (!/^stream: [^\0\r\n]{1,300} FOUND[\0\r\n]*$/.test(responses.eicar ?? "")) problems.push("SCANNER_INFECTED_CONTROL_FAILED");
  return { verified: problems.length === 0, problems };
}

export function awsRead(command, env = process.env) {
  const allowed = new Set(["sts:get-caller-identity", "s3api:get-bucket-location", "s3api:get-bucket-versioning", "s3api:get-object-lock-configuration", "s3api:get-public-access-block", "s3api:get-bucket-policy-status", "s3api:get-bucket-encryption", "s3api:head-object", "kms:describe-key"]);
  if (!allowed.has(`${command[0]}:${command[1]}`)) throw new Error("AWS_READ_ONLY_COMMAND_REQUIRED");
  const service = command[0] === "s3api" ? "s3" : command[0];
  const result = spawnSync("aws", [...command, "--region", REGION, "--endpoint-url", `https://${service}.${REGION}.amazonaws.com`, "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "5", "--cli-read-timeout", "10"], { env: { ...env, AWS_EC2_METADATA_DISABLED: "true", AWS_PAGER: "" }, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
  // Never expose CLI errors, request arguments, credentials, ARN, object keys or hostnames.
  if (result.error?.code === "ENOENT") throw new Error("AWS_CLI_UNAVAILABLE");
  if (result.error || result.status !== 0) throw new Error("AWS_READ_ACCESS_OR_CONNECTIVITY_FAILED");
  try { return JSON.parse(result.stdout); } catch { throw new Error("AWS_METADATA_RESPONSE_INVALID"); }
}

export function tlsProbe(config, command, bytes) {
  if (!["PING", "VERSION", "INSTREAM"].includes(command) || (command === "INSTREAM" && (!Buffer.isBuffer(bytes) || (!bytes.equals(CLEAN_PROBE) && !bytes.equals(EICAR_PROBE))))) {
    return Promise.reject(new Error("SCANNER_SYNTHETIC_PROBE_REQUIRED"));
  }
  return new Promise((resolve, reject) => {
    let reply = ""; let done = false;
    const socket = connect({ host: config.CLIENT_DOCUMENTS_CLAMAV_HOST, port: Number(config.CLIENT_DOCUMENTS_CLAMAV_PORT ?? "3310"), servername: config.CLIENT_DOCUMENTS_CLAMAV_HOST, rejectUnauthorized: true, minVersion: "TLSv1.2",
      ...(config.CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE === "mtls" ? { cert: config.CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM, key: config.CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM } : {}),
      ...(config.CLIENT_DOCUMENTS_CLAMAV_CA_PEM ? { ca: config.CLIENT_DOCUMENTS_CLAMAV_CA_PEM } : {}),
    });
    const finish = (value, failed = false) => { if (done) return; done = true; clearTimeout(deadline); socket.destroy(); if (failed) reject(new Error("SCANNER_TLS_OR_CONNECTIVITY_FAILED")); else resolve(value); };
    // Independent of idle activity: slow-drip replies must not keep a probe open.
    const deadline = setTimeout(() => finish(null, true), 12_000);
    socket.setTimeout(12_000);
    socket.on("error", () => finish(null, true)); socket.on("timeout", () => finish(null, true));
    socket.on("secureConnect", () => {
      if (done) return;
      if (!socket.authorized) { finish(null, true); return; }
      socket.write(`z${command}\0`);
      if (command === "INSTREAM") {
        const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
        socket.write(length); socket.write(bytes); socket.write(Buffer.alloc(4));
      }
    });
    socket.on("data", (chunk) => { if (done) return; reply += chunk.toString("utf8"); if (reply.length > 4096) finish(null, true); else if (reply.includes("\0") || reply.includes("\n")) finish(reply); });
    socket.on("end", () => finish(null, true)); socket.on("close", () => finish(null, true));
  });
}

export async function inspectInfrastructure(env, { live = false, aws = awsRead, scanner = tlsProbe, now = new Date() } = {}) {
  const configuration = inspectConfiguration(env);
  const report = { checkedAt: now.toISOString(), mode: live ? "live_read_only" : "configuration_only", configuration, archive: { verified: false, problems: [] }, scanner: { verified: false, problems: [] }, operatorEnablementRecommended: false };
  if (!configuration.valid || !live) return report;
  const safeProblem = (error) => ["AWS_CLI_UNAVAILABLE", "AWS_READ_ACCESS_OR_CONNECTIVITY_FAILED", "AWS_METADATA_RESPONSE_INVALID", "SCANNER_TLS_OR_CONNECTIVITY_FAILED"].includes(error?.message) ? error.message : "INFRASTRUCTURE_VERIFICATION_FAILED";
  try {
    const identity = aws(["sts", "get-caller-identity"], env);
    const args = ["--bucket", env.HTML_ARCHIVE_BUCKET, "--expected-bucket-owner", identity.Account];
    const data = { identity };
    for (const [field, command] of Object.entries({ location: "get-bucket-location", versioning: "get-bucket-versioning", lock: "get-object-lock-configuration", publicAccess: "get-public-access-block", policyStatus: "get-bucket-policy-status", encryption: "get-bucket-encryption" })) data[field] = aws(["s3api", command, ...args], env);
    data.kms = aws(["kms", "describe-key", "--key-id", env.AWS_KMS_KEY_ID], env);
    if (/^healthchecks\/intake\/[a-zA-Z0-9._/-]{1,160}$/.test(env.INTAKE_PREFLIGHT_CANARY_KEY ?? "") && !env.INTAKE_PREFLIGHT_CANARY_KEY.includes("..") && /^[a-zA-Z0-9+/=._~-]{1,1024}$/.test(env.INTAKE_PREFLIGHT_CANARY_VERSION ?? "") && /^[a-f0-9]{64}$/.test(env.INTAKE_PREFLIGHT_CANARY_SHA256 ?? "")) data.canary = aws(["s3api", "head-object", ...args, "--key", env.INTAKE_PREFLIGHT_CANARY_KEY, "--version-id", env.INTAKE_PREFLIGHT_CANARY_VERSION, "--checksum-mode", "ENABLED"], env);
    report.archive = verifyArchiveMetadata(data, env, now);
  } catch (error) { report.archive.problems = [safeProblem(error)]; }
  try {
    const responses = { ping: await scanner(env, "PING"), version: await scanner(env, "VERSION"), clean: await scanner(env, "INSTREAM", CLEAN_PROBE), eicar: await scanner(env, "INSTREAM", EICAR_PROBE) };
    report.scanner = verifyScannerResponses(responses, now);
  } catch (error) { report.scanner.problems = [safeProblem(error)]; }
  report.operatorEnablementRecommended = report.archive.verified && report.scanner.verified && env.CLIENT_DOCUMENTS_SCANNER_APPROVED === "true";
  if (env.CLIENT_DOCUMENTS_SCANNER_APPROVED !== "true") report.scanner.problems.push("SCANNER_GOVERNANCE_APPROVAL_REQUIRED");
  return report;
}
