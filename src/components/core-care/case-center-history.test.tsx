// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaseCenterHistory, CaseCenterWorkLink } from "./case-center-history";

const clientId = "02000000-0000-4000-8000-000000000001";

beforeEach(() => {
  window.history.replaceState({ __NA: true, preserved: "router-state" }, "", "/app/clients");
  vi.stubGlobal("scrollY", 456);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("case-center history write cost", () => {
  it("writes the same client and scroll state only once during a pointer activation", () => {
    render(<><CaseCenterHistory /><CaseCenterWorkLink clientId={clientId} clientName="合成個案" href="/app/clients/work" /></>);
    const link = screen.getByRole("link", { name: "進入個案工作" });
    link.addEventListener("click", (event) => event.preventDefault());
    const replace = vi.spyOn(window.history, "replaceState");

    fireEvent.pointerDown(link);
    fireEvent.click(link);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.history.state).toMatchObject({
      __NA: true, preserved: "router-state", caseCenterScrollY: 456, caseCenterFocusClientId: clientId,
    });
  });

  it("still saves changed scroll and a different client, without repeating an Enter activation", () => {
    const otherClientId = "02000000-0000-4000-8000-000000000099";
    render(<><CaseCenterHistory />
      <CaseCenterWorkLink clientId={clientId} clientName="合成個案甲" href="/app/clients/first" />
      <CaseCenterWorkLink clientId={otherClientId} clientName="合成個案乙" href="/app/clients/second" />
    </>);
    const [first, second] = screen.getAllByRole("link");
    for (const link of [first, second]) link!.addEventListener("click", (event) => event.preventDefault());
    const replace = vi.spyOn(window.history, "replaceState");

    fireEvent.keyDown(first!, { key: "Enter" });
    fireEvent.click(first!);
    expect(replace).toHaveBeenCalledTimes(1);

    vi.stubGlobal("scrollY", 912);
    fireEvent.pointerDown(first!);
    fireEvent.click(first!);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.history.state).toMatchObject({ caseCenterScrollY: 912, caseCenterFocusClientId: clientId });

    fireEvent.pointerDown(second!);
    fireEvent.click(second!);
    expect(replace).toHaveBeenCalledTimes(3);
    expect(window.history.state).toMatchObject({
      __NA: true, preserved: "router-state", caseCenterScrollY: 912, caseCenterFocusClientId: otherClientId,
    });
  });
});
