// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  getScopeChangePendingReason,
  hasScopeChangePending,
  useScopeChangeDraftRegistration,
  useScopeChangePendingReason,
  type ScopeChangeDraftState,
} from "./scope-change-pending";

afterEach(cleanup);

describe("scope-change pending registry", () => {
  it("publishes dirty, busy and unknown synchronously, prioritizing uncertain writes", () => {
    let update!: (state: ScopeChangeDraftState) => void;
    const seen: Array<string | null> = [];
    function Draft() { update = useScopeChangeDraftRegistration(); return null; }
    function Observer() { seen.push(useScopeChangePendingReason()); return null; }
    const view = render(<><Draft /><Observer /></>);
    expect(hasScopeChangePending()).toBe(false);
    act(() => update({ dirty: true, busy: false, unknown: false }));
    expect(getScopeChangePendingReason()).toBe("dirty");
    act(() => update({ dirty: true, busy: true, unknown: false }));
    expect(getScopeChangePendingReason()).toBe("busy");
    act(() => update({ dirty: true, busy: false, unknown: true }));
    expect(getScopeChangePendingReason()).toBe("unknown");
    expect(seen).toContain("unknown");
    act(() => update({ dirty: false, busy: false, unknown: false }));
    expect(hasScopeChangePending()).toBe(false);
    view.unmount();
  });

  it("does not resurrect a pending entry from a late callback after unmount", () => {
    let update!: (state: ScopeChangeDraftState) => void;
    function Draft() { update = useScopeChangeDraftRegistration(); return null; }
    const view = render(<Draft />);
    act(() => update({ dirty: false, busy: false, unknown: true }));
    expect(hasScopeChangePending()).toBe(true);
    view.unmount();
    expect(hasScopeChangePending()).toBe(false);
    act(() => update({ dirty: true, busy: false, unknown: true }));
    expect(hasScopeChangePending()).toBe(false);
  });
});
