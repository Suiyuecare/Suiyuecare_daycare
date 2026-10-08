// @vitest-environment node

import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoInsulinAdministrationSnapshot } from "@/lib/insulin-administrations/demo";

import {
  InsulinAdministrationActions,
  InsulinMutationProvider,
  insulinMutationStoreCountForTests,
  resetInsulinMutationStateForTests,
} from "./insulin-administration-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => resetInsulinMutationStateForTests());

describe("insulin server pre-render isolation", () => {
  it("does not retain actor or medication slot metadata in a process-global Map", () => {
    const snapshot = buildDemoInsulinAdministrationSnapshot({
      serviceDate: "2026-09-02", shift: "all", clientId: null, state: "all",
    });
    expect(insulinMutationStoreCountForTests()).toBe(0);
    for (const actorId of ["synthetic-actor-one", "synthetic-actor-two"]) {
      renderToString(<InsulinMutationProvider actorId={actorId} snapshot={snapshot}>
        {snapshot.items.map((item) => <InsulinAdministrationActions key={item.medicationPlanId}
          item={item} snapshot={snapshot} />)}
      </InsulinMutationProvider>);
      expect(insulinMutationStoreCountForTests()).toBe(0);
    }
  });
});
