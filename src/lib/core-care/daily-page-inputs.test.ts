import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ daily: vi.fn(), routine: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./snapshot", () => ({
  CoreCareSnapshotError: class CoreCareSnapshotError extends Error {},
  loadDailyCareSnapshot: mocks.daily,
}));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mocks.routine }));

import { CoreCareSnapshotError } from "./snapshot";
import { loadCoreDailyPageInputs } from "./daily-page-inputs";

const context: TenantContext = {
  organizationId: "d0000000-0000-4000-8000-000000000001",
  organizationName: "合成機構",
  branchId: "b0000000-0000-4000-8000-000000000001",
  branchName: "合成分支",
  userId: "a0000000-0000-4000-8000-000000000001",
  displayName: "合成同仁",
  roles: ["care_worker"],
  scopes: ["clients.read", "care_records.read", "care_records.write"],
  assuranceLevel: "aal1",
  recentAal2At: null,
  demo: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.daily.mockResolvedValue({ marker: "snapshot" });
  mocks.routine.mockResolvedValue(true);
});

describe("core daily page read-only inputs", () => {
  it("starts both diary preflights before the daily snapshot resolves", async () => {
    let resolveDaily!: (value: unknown) => void;
    mocks.daily.mockReturnValue(new Promise((resolve) => { resolveDaily = resolve; }));

    const pending = loadCoreDailyPageInputs(context, "2026-10-03", 6);
    expect(mocks.daily).toHaveBeenCalledExactlyOnceWith(context, "2026-10-03");
    expect(mocks.routine.mock.calls).toEqual([
      [context, "care_records.write"],
      [context, "care_records.read"],
    ]);

    resolveDaily({ marker: "snapshot" });
    await expect(pending).resolves.toMatchObject({
      snapshot: { marker: "snapshot" },
      loadError: false,
      canWriteRoutine: true,
      canReadDiary: true,
    });
  });

  it.each([[3, "health.write"], [46, "attendance.write"]] as const)(
    "checks only the page %s write preflight",
    async (pageNumber, permission) => {
      const result = await loadCoreDailyPageInputs(context, "2026-10-03", pageNumber);
      expect(mocks.routine).toHaveBeenCalledExactlyOnceWith(context, permission);
      expect(result.canReadDiary).toBe(false);
    },
  );

  it("keeps a known snapshot error separate from denied or failed permission preflights", async () => {
    mocks.daily.mockRejectedValue(new CoreCareSnapshotError());
    mocks.routine.mockResolvedValue(false);

    await expect(loadCoreDailyPageInputs(context, "2026-10-03", 6)).resolves.toMatchObject({
      snapshot: null,
      loadError: true,
      canWriteRoutine: false,
      canReadDiary: false,
    });
  });

  it("still propagates an unexpected snapshot failure", async () => {
    mocks.daily.mockRejectedValue(new Error("unexpected snapshot failure"));

    await expect(loadCoreDailyPageInputs(context, "2026-10-03", 3))
      .rejects.toThrow("unexpected snapshot failure");
  });
});
