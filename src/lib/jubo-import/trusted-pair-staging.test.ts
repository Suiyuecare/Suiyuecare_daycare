import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./trusted-pair-preparation", () => ({ prepareApprovedJuboPair: vi.fn() }));

import { prepareApprovedJuboPair, type JuboPreparedPair } from "./trusted-pair-preparation";
import { createVerifiedJuboSqlDatabase, stageApprovedJuboPair,
  type VerifiedJuboSqlDatabase } from "./trusted-pair-staging";

const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";
const ACTOR = "30000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-000000000001";
const MASTER_BATCH = "50000000-0000-4000-8000-000000000001";
const MONTHLY_BATCH = "50000000-0000-4000-8000-000000000002";
const VERIFIED_PAIR = "60000000-0000-4000-8000-000000000001";
const OPERATION = "70000000-0000-4000-8000-000000000001";
const CHALLENGE = "71000000-0000-4000-8000-000000000001";
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FOOTER_REASON = "已逐格查核合成來源末列僅 A 欄為註記，非個案資料";

// Deliberately synthetic pair: the existing reader/preparer has separate ZIP,
// pinned-hash and real-source opt-in tests. This suite tests only DB handoff.
function syntheticPair(): JuboPreparedPair {
  const row = (sheetRow: number, width: number, identity: number, status: string | null) => {
    const rawValues = Array<unknown>(width).fill(null);
    rawValues[width === 95 ? 25 : 29] = `ZZTEST${String(identity).padStart(6, "0")}`;
    if (width === 95) rawValues[15] = status;
    else rawValues[3] = status;
    const normalizedValues = [...rawValues];
    normalizedValues[width === 95 ? 8 : 9] = "2026-01-02";
    return { sheetRow, rawValues, normalizedValues, rawCellTypes: Array<string | null>(width).fill(null) };
  };
  const masterRows = Array.from({ length: 23 }, (_, index) => row(index + 6, 95, index + 1,
    index < 17 ? "服務中" : index === 17 ? "暫停服務" : "結案"));
  const monthlyRows = Array.from({ length: 17 }, (_, index) => row(index + 5, 191, index + 1, "服務中"));
  const footerValues = Array<unknown>(95).fill(null);
  footerValues[0] = "合成來源註記";
  return {
    organizationId: ORG, branchId: BRANCH, actorUserId: ACTOR, idempotencyKey: KEY,
    requestSha256: "9".repeat(64), parserVersion: "jubo-xlsx-reader-202610-v1",
    master: { kind: "master", fileName: "synthetic-master.xlsx", sheetName: "合成主表",
      sha256: "a".repeat(64), byteLength: 22, sourceBytesHex: "504b" + "00".repeat(20),
      columnLabels: Array(95).fill("合成欄位"), rows: masterRows },
    monthlySummary: { kind: "monthlySummary", fileName: "synthetic-monthly.xlsx", sheetName: "合成當月表",
      sha256: "b".repeat(64), byteLength: 22, sourceBytesHex: "504b" + "11".repeat(20),
      columnLabels: Array(191).fill("合成欄位"), rows: monthlyRows },
    masterNonRecordRows: [{ sheetRow: 29, rawValues: footerValues,
      normalizedValues: [...footerValues], rawCellTypes: Array(95).fill(null) }],
    plan: { mappingVersion: "jubo-master-monthly-202610-v2", organizationId: ORG,
      branchId: BRANCH, masterRowCount: 23, monthlySummaryRowCount: 17,
      matchedSummaryRowCount: 17, clients: [] }, formallyImported: false,
  };
}

type Call = { sql: string; values: readonly unknown[] };
function syntheticDatabase(options: {
  denied?: boolean; failOnRow?: number;
  prior?: { requestSha256: string; organizationId?: string };
} = {}) {
  const committed: Call[] = [];
  let calls: Call[] = [];
  const db: VerifiedJuboSqlDatabase = {
    withVerifiedUserTransaction: async (actor, action) => {
      expect(actor).toBe(ACTOR);
      calls = [];
      const tx = { query: async <T extends Record<string, unknown>>(sql: string, values: readonly unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("private.require_import_upload_authority")) {
          return { rows: [{ actor_user_id: ACTOR, can_approve: !options.denied,
            challenge_id: CHALLENGE }] as unknown as T[] };
        }
        if (sql.includes("from private.jubo_source_stage_operations")) {
          return { rows: options.prior ? [{ id: OPERATION, organization_id: options.prior.organizationId ?? ORG,
            branch_id: BRANCH, request_sha256: options.prior.requestSha256,
            master_batch_id: MASTER_BATCH, monthly_batch_id: MONTHLY_BATCH,
            verified_pair_id: VERIFIED_PAIR }] as unknown as T[] : [] as T[] };
        }
        if (sql.includes("insert into private.jubo_source_batches")) {
          const id = calls.filter((call) => call.sql.includes("insert into private.jubo_source_batches")).length === 1
            ? MASTER_BATCH : MONTHLY_BATCH;
          return { rows: [{ id }] as unknown as T[] };
        }
        if (sql.includes("insert into private.jubo_source_rows")) {
          if (options.failOnRow && calls.filter((call) => call.sql.includes("insert into private.jubo_source_rows")).length === options.failOnRow) {
            throw new Error("synthetic DB failure with data that must not be returned");
          }
          return { rows: [{ id: "80000000-0000-4000-8000-000000000001" }] as unknown as T[] };
        }
        if (sql.includes("insert into private.jubo_source_nonrecord_rows")) {
          return { rows: [{ id: "80000000-0000-4000-8000-000000000002" }] as unknown as T[] };
        }
        if (sql.includes("private.register_verified_jubo_pair")) return { rows: [{ id: VERIFIED_PAIR }] as unknown as T[] };
        if (sql.includes("insert into private.jubo_source_stage_operations")) return { rows: [{ id: OPERATION }] as unknown as T[] };
        return { rows: [] as T[] };
      } };
      const result = await action(tx);
      committed.push(...calls);
      return result;
    },
  };
  return { db, committed, calls: () => calls };
}

function input() {
  const file = { fileName: "synthetic.xlsx", mimeType: MIME, bytes: new Uint8Array(22) };
  return { organizationId: ORG, branchId: BRANCH, actorUserId: ACTOR, idempotencyKey: KEY,
    master: { ...file, kind: "master" as const },
    monthlySummary: { ...file, kind: "monthlySummary" as const }, footerReviewReason: FOOTER_REASON };
}

describe("JUBO exact-byte private staging handoff (synthetic only)", () => {
  it("persists bytea, all original and normalized row coordinates, footer and attestation in one transaction", async () => {
    vi.mocked(prepareApprovedJuboPair).mockReturnValue(syntheticPair());
    const { db, committed } = syntheticDatabase();
    const result = await stageApprovedJuboPair({ database: db, hmacSecret: "synthetic secret of 32 bytes or more" }, input());
    expect(result).toMatchObject({ verifiedPairId: VERIFIED_PAIR, masterRows: 23,
      monthlyRows: 17, sourceStatus: { active: 17, suspended: 1, closed: 5 },
      stagingOnly: true, formallyImported: false, replayed: false });
    expect(committed.filter((call) => call.sql.includes("insert into private.jubo_source_rows"))).toHaveLength(40);
    expect(committed.filter((call) => call.sql.includes("insert into private.jubo_source_nonrecord_rows"))).toHaveLength(1);
    const batches = committed.filter((call) => call.sql.includes("insert into private.jubo_source_batches"));
    expect(batches).toHaveLength(2);
    expect(batches[0].values[10]).toBe(syntheticPair().master.sourceBytesHex);
    expect(batches[1].values[10]).toBe(syntheticPair().monthlySummary.sourceBytesHex);
    const attestation = committed.find((call) => call.sql.includes("private.register_verified_jubo_pair"));
    expect(attestation?.values.slice(4, 6)).toEqual(batches.map((batch) => batch.values[10]));
    const masterRow = committed.find((call) => call.sql.includes("insert into private.jubo_source_rows"));
    expect(masterRow?.values[3]).toBe(6);
    expect(JSON.parse(masterRow!.values[5] as string)[15]).toBe("服務中");
    expect(JSON.parse(masterRow!.values[6] as string)[8]).toBe("2026-01-02");
    expect(committed.every((call) => !call.sql.includes("public.clients"))).toBe(true);
  });

  it("rejects absent human footer classification before parsing or writing", async () => {
    vi.mocked(prepareApprovedJuboPair).mockClear();
    const { db, committed } = syntheticDatabase();
    await expect(stageApprovedJuboPair({ database: db, hmacSecret: "synthetic" },
      { ...input(), footerReviewReason: "" })).rejects.toMatchObject({ code: "FOOTER_REVIEW_REQUIRED" });
    expect(prepareApprovedJuboPair).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it("denies a mismatched or unapproved live actor before private inserts", async () => {
    vi.mocked(prepareApprovedJuboPair).mockReturnValue(syntheticPair());
    const { db, committed, calls } = syntheticDatabase({ denied: true });
    await expect(stageApprovedJuboPair({ database: db, hmacSecret: "synthetic" }, input()))
      .rejects.toMatchObject({ code: "UNVERIFIED_ACTOR" });
    expect(committed).toHaveLength(0);
    expect(calls().some((call) => call.sql.includes("insert into"))).toBe(false);
  });

  it("does not commit a partial pair if any staged row fails", async () => {
    vi.mocked(prepareApprovedJuboPair).mockReturnValue(syntheticPair());
    const { db, committed, calls } = syntheticDatabase({ failOnRow: 9 });
    await expect(stageApprovedJuboPair({ database: db, hmacSecret: "synthetic" }, input()))
      .rejects.toMatchObject({ code: "STAGING_RESULT_UNKNOWN" });
    expect(calls().filter((call) => call.sql.includes("insert into private.jubo_source_rows"))).toHaveLength(9);
    expect(committed).toHaveLength(0);
  });

  it("replays only the same actor, scope, key, bytes and footer decision", async () => {
    vi.mocked(prepareApprovedJuboPair).mockReturnValue(syntheticPair());
    const { createHash } = await import("node:crypto");
    const requestSha256 = createHash("sha256").update(JSON.stringify([
      "jubo-private-stage-v1", syntheticPair().requestSha256, FOOTER_REASON,
    ])).digest("hex");
    const { db, committed } = syntheticDatabase({ prior: { requestSha256 } });
    const result = await stageApprovedJuboPair({ database: db, hmacSecret: "synthetic" }, input());
    expect(result.replayed).toBe(true);
    expect(committed.some((call) => call.sql.includes("insert into"))).toBe(false);

    const conflicting = syntheticDatabase({ prior: { requestSha256: "f".repeat(64) } });
    await expect(stageApprovedJuboPair({ database: conflicting.db, hmacSecret: "synthetic" }, input()))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(conflicting.committed).toHaveLength(0);
    const otherBranch = syntheticDatabase({ prior: { requestSha256, organizationId: "90000000-0000-4000-8000-000000000001" } });
    await expect(stageApprovedJuboPair({ database: otherBranch.db, hmacSecret: "synthetic" }, input()))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});

function syntheticJwt(aal: string) {
  return ["synthetic-header", Buffer.from(JSON.stringify({ sub: ACTOR,
    session_id: "72000000-0000-4000-8000-000000000001", aal,
    role: "authenticated", exp: Math.floor(Date.now() / 1000) + 300,
    email: "must-not-enter-db@example.invalid" })).toString("base64url"), "synthetic-signature"].join(".");
}

describe("server-owned JUBO PostgreSQL transaction binder (synthetic only)", () => {
  it("binds only online-verified AAL2 claims for one transaction and releases the connection", async () => {
    const queries: Call[] = [];
    const release = vi.fn();
    const token = syntheticJwt("aal2");
    const database = createVerifiedJuboSqlDatabase({ connect: async () => ({
      query: async <T extends Record<string, unknown>>(sql: string, values: readonly unknown[]) => {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      }, release,
    }) }, { accessToken: async () => token,
      getUser: async (supplied) => ({ data: { user: { id: ACTOR } },
        error: supplied === token ? null : new Error("synthetic token mismatch") }) });
    const result = await database.withVerifiedUserTransaction(ACTOR, async (tx) => {
      await tx.query("select 1", []);
      return "synthetic-result";
    });
    expect(result).toBe("synthetic-result");
    expect(queries.map((query) => query.sql)).toEqual([
      "begin", "select set_config('request.jwt.claims',$1,true)", "select 1", "commit",
    ]);
    expect(JSON.parse(queries[1].values[0] as string)).toEqual({
      sub: ACTOR, session_id: "72000000-0000-4000-8000-000000000001",
      aal: "aal2", role: "authenticated", exp: expect.any(Number),
    });
    expect(queries.some((query) => query.values.includes(token))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects AAL1 or an Auth-unverified token before opening PostgreSQL", async () => {
    const connect = vi.fn();
    const denied = createVerifiedJuboSqlDatabase({ connect }, {
      accessToken: async () => syntheticJwt("aal1"),
      getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }),
    });
    await expect(denied.withVerifiedUserTransaction(ACTOR, async () => null))
      .rejects.toMatchObject({ code: "UNVERIFIED_ACTOR" });
    const unverified = createVerifiedJuboSqlDatabase({ connect }, {
      accessToken: async () => syntheticJwt("aal2"),
      getUser: async () => ({ data: { user: null }, error: new Error("rejected") }),
    });
    await expect(unverified.withVerifiedUserTransaction(ACTOR, async () => null))
      .rejects.toMatchObject({ code: "UNVERIFIED_ACTOR" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rolls back and releases the same connection when a write fails", async () => {
    const commands: string[] = [];
    const release = vi.fn();
    const database = createVerifiedJuboSqlDatabase({ connect: async () => ({
      query: async <T extends Record<string, unknown>>(sql: string) => {
        commands.push(sql);
        return { rows: [] as T[] };
      }, release,
    }) }, { accessToken: async () => syntheticJwt("aal2"),
      getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }) });
    await expect(database.withVerifiedUserTransaction(ACTOR, async () => {
      throw new Error("synthetic write failure");
    })).rejects.toThrow("synthetic write failure");
    expect(commands).toEqual(["begin", "select set_config('request.jwt.claims',$1,true)", "rollback"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("discards a connection after an unknown COMMIT result", async () => {
    const commands: string[] = [];
    const release = vi.fn();
    const database = createVerifiedJuboSqlDatabase({ connect: async () => ({
      query: async <T extends Record<string, unknown>>(sql: string) => {
        commands.push(sql);
        if (sql === "commit") throw new Error("synthetic transport timeout");
        return { rows: [] as T[] };
      }, release,
    }) }, { accessToken: async () => syntheticJwt("aal2"),
      getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }) });
    await expect(database.withVerifiedUserTransaction(ACTOR, async () => "synthetic-result"))
      .rejects.toThrow("synthetic transport timeout");
    expect(commands).toEqual(["begin", "select set_config('request.jwt.claims',$1,true)", "commit", "rollback"]);
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });
});
