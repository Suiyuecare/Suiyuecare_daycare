import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import StaffHomeShortcut from "./page";

describe("staff root route", () => {
  it("opens the existing dashboard instead of a missing /app page", () => {
    StaffHomeShortcut();
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/app/dashboard");
  });
});
