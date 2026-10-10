import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), connect: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  isDemoMode: vi.fn(() => false), isSyntheticPreviewMode: vi.fn(() => false),
  createVerifiedJuboSqlDatabase: vi.fn(), stageApprovedJuboPair: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({ Pool: mocks.pool }));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.isDemoMode,
  isSyntheticPreviewMode: mocks.isSyntheticPreviewMode }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("./trusted-pair-staging", () => ({
  createVerifiedJuboSqlDatabase: mocks.createVerifiedJuboSqlDatabase,
  stageApprovedJuboPair: mocks.stageApprovedJuboPair,
}));

import { resolveJuboStageRuntimeConfiguration,
  stageApprovedJuboPairForCurrentStaff } from "./trusted-pair-runtime";

const REF = "aaaaaaaaaaaaaaaaaaaa";
const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";
const ACTOR = "30000000-0000-4000-8000-000000000001";
const TOKEN = "synthetic-cookie-access-token";
const DATABASE_URL = `postgresql://postgres.${REF}:synthetic%40password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;
const HMAC = "synthetic-server-only-hmac-secret-over-32-bytes";

function enabledEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_REGION: "hnd1",
    JUBO_PRIVATE_STAGE_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
    JUBO_PRIVATE_STAGE_DATABASE_URL: DATABASE_URL, JUBO_PRIVATE_STAGE_HMAC_SECRET: HMAC,
    JUBO_PRIVATE_STAGE_ORGANIZATION_ID: ORG, JUBO_PRIVATE_STAGE_BRANCH_ID: BRANCH,
    ...overrides };
}

function input() {
  const file = { fileName: "synthetic.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: new Uint8Array([0x50, 0x4b, 0, 0]) };
  return { idempotencyKey: "40000000-0000-4000-8000-000000000001",
    master: { ...file, kind: "master" as const },
    monthlySummary: { ...file, kind: "monthlySummary" as const },
    footerReviewReason: "已檢查合成測試來源末列為非個案註記" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDemoMode.mockReturnValue(false);
  mocks.isSyntheticPreviewMode.mockReturnValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("JUBO production runtime switch and Tokyo binding", () => {
  it("stays off by default, outside production, or outside hnd1", () => {
    for (const environment of [
      enabledEnvironment({ JUBO_PRIVATE_STAGE_ENABLED: "false" }),
      enabledEnvironment({ JUBO_PRIVATE_STAGE_ENABLED: "TRUE" }),
      enabledEnvironment({ VERCEL_ENV: "preview" }),
      enabledEnvironment({ NODE_ENV: "test" }),
      enabledEnvironment({ VERCEL_REGION: "icn1" }),
    ]) expect(() => resolveJuboStageRuntimeConfiguration(environment))
      .toThrowError(expect.objectContaining({ code: "DISABLED" }));
  });

  it("rejects absent credentials, a different Auth project, Seoul, direct or non-TLS-like endpoints", () => {
    const bad: Array<Record<string, string>> = [
      { JUBO_PRIVATE_STAGE_HMAC_SECRET: "short" },
      { JUBO_PRIVATE_STAGE_ORGANIZATION_ID: "not-a-uuid" },
      { JUBO_PRIVATE_STAGE_DATABASE_URL: "" },
      { NEXT_PUBLIC_SUPABASE_URL: "https://bbbbbbbbbbbbbbbbbbbb.supabase.co" },
      { JUBO_PRIVATE_STAGE_DATABASE_URL: DATABASE_URL.replace("ap-northeast-1", "ap-northeast-2") },
      { JUBO_PRIVATE_STAGE_DATABASE_URL: DATABASE_URL.replace(":6543", ":5432") },
      { JUBO_PRIVATE_STAGE_DATABASE_URL: DATABASE_URL.replace("postgresql:", "http:") },
      { JUBO_PRIVATE_STAGE_DATABASE_URL: DATABASE_URL.replace("/postgres", "/postgres?sslmode=disable") },
    ];
    for (const override of bad) expect(() => resolveJuboStageRuntimeConfiguration(
      enabledEnvironment(override),
    )).toThrowError(expect.objectContaining({ code: "MISCONFIGURED" }));
  });

  it("accepts only the pinned organization, branch and Tokyo pooler configuration", () => {
    const config = resolveJuboStageRuntimeConfiguration(enabledEnvironment());
    expect(config).toEqual({ organizationId: ORG, branchId: BRANCH,
      databaseUrl: DATABASE_URL, hmacSecret: HMAC });
  });

  it("does not read cookies, open PostgreSQL or stage when disabled", async () => {
    vi.stubEnv("JUBO_PRIVATE_STAGE_ENABLED", "false");
    await expect(stageApprovedJuboPairForCurrentStaff(input()))
      .rejects.toMatchObject({ code: "DISABLED" });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.stageApprovedJuboPair).not.toHaveBeenCalled();
  });

  it("verifies cookie token online and staff admission before creating a private pool", async () => {
    for (const [key, value] of Object.entries(enabledEnvironment())) vi.stubEnv(key, value);
    const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: TOKEN } }, error: null });
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: ACTOR } }, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getSession, getUser }, rpc });
    const poolInstance = { connect: mocks.connect, on: vi.fn() };
    mocks.pool.mockImplementation(function syntheticPool() { return poolInstance; });
    const database = { withVerifiedUserTransaction: vi.fn() };
    mocks.createVerifiedJuboSqlDatabase.mockReturnValue(database);
    const receipt = { stagingOnly: true, formallyImported: false };
    mocks.stageApprovedJuboPair.mockResolvedValue(receipt);

    await expect(stageApprovedJuboPairForCurrentStaff(input())).resolves.toBe(receipt);
    expect(getSession).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledWith(TOKEN);
    expect(rpc).toHaveBeenCalledWith("is_staff_login_allowed");
    expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: DATABASE_URL, max: 1, ssl: { rejectUnauthorized: true },
    }));
    expect(poolInstance.on).toHaveBeenCalledWith("error", expect.any(Function));
    const [adapter, provider] = mocks.createVerifiedJuboSqlDatabase.mock.calls[0];
    expect(adapter).toHaveProperty("connect");
    expect(await provider.accessToken()).toBe(TOKEN);
    await provider.getUser(TOKEN);
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(mocks.stageApprovedJuboPair).toHaveBeenCalledWith(
      { database, hmacSecret: HMAC },
      { ...input(), organizationId: ORG, branchId: BRANCH, actorUserId: ACTOR },
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    const query = vi.fn().mockResolvedValue({ rows: [{ marker: "synthetic" }] });
    const release = vi.fn();
    mocks.connect.mockResolvedValueOnce({ query, release });
    const privateClient = await adapter.connect();
    await expect(privateClient.query("select $1 as marker", ["synthetic"]))
      .resolves.toEqual({ rows: [{ marker: "synthetic" }] });
    expect(query).toHaveBeenCalledWith("select $1 as marker", ["synthetic"]);
    privateClient.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed on missing session, unverified user or failed staff admission", async () => {
    for (const [key, value] of Object.entries(enabledEnvironment())) vi.stubEnv(key, value);
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("synthetic") });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getSession, getUser }, rpc });
    getSession.mockRejectedValueOnce(new Error("synthetic cookie failure"));
    await expect(stageApprovedJuboPairForCurrentStaff(input())).rejects.toMatchObject({ code: "AUTH_DENIED" });
    await expect(stageApprovedJuboPairForCurrentStaff(input())).rejects.toMatchObject({ code: "AUTH_DENIED" });
    getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } }, error: null });
    await expect(stageApprovedJuboPairForCurrentStaff(input())).rejects.toMatchObject({ code: "AUTH_DENIED" });
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } }, error: null });
    await expect(stageApprovedJuboPairForCurrentStaff(input())).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.stageApprovedJuboPair).not.toHaveBeenCalled();
  });
});
