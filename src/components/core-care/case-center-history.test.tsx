// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaseCenterHistory, CaseCenterWorkLink } from "./case-center-history";

const clientId = "02000000-0000-4000-8000-000000000001";
let stage: HTMLElement;

beforeEach(() => {
  window.history.replaceState({ __NA: true, preserved: "router-state" }, "", "/app/clients");
  stage = document.createElement("main");
  stage.className = "main-stage";
  stage.scrollTop = 456;
  document.body.append(stage);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  stage.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("case-center history write cost", () => {
  it("writes the same client and scroll state only once during a pointer activation", () => {
    render(<><CaseCenterHistory /><CaseCenterWorkLink clientId={clientId} clientName="合成個案" href="/app/clients/work" /></>, { container: stage });
    const link = screen.getByRole("link", { name: "進入個案工作" });
    link.addEventListener("click", (event) => event.preventDefault());
    const replace = vi.spyOn(window.history, "replaceState");

    fireEvent.pointerDown(link);
    fireEvent.click(link);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.history.state).toMatchObject({
      __NA: true, preserved: "router-state", caseCenterScrollTop: 456, caseCenterFocusClientId: clientId,
    });
  });

  it("still saves changed scroll and a different client, without repeating an Enter activation", () => {
    const otherClientId = "02000000-0000-4000-8000-000000000099";
    render(<><CaseCenterHistory />
      <CaseCenterWorkLink clientId={clientId} clientName="合成個案甲" href="/app/clients/first" />
      <CaseCenterWorkLink clientId={otherClientId} clientName="合成個案乙" href="/app/clients/second" />
    </>, { container: stage });
    const [first, second] = screen.getAllByRole("link");
    for (const link of [first, second]) link!.addEventListener("click", (event) => event.preventDefault());
    const replace = vi.spyOn(window.history, "replaceState");

    fireEvent.keyDown(first!, { key: "Enter" });
    fireEvent.click(first!);
    expect(replace).toHaveBeenCalledTimes(1);

    stage.scrollTop = 912;
    fireEvent.pointerDown(first!);
    fireEvent.click(first!);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.history.state).toMatchObject({ caseCenterScrollTop: 912, caseCenterFocusClientId: clientId });

    fireEvent.pointerDown(second!);
    fireEvent.click(second!);
    expect(replace).toHaveBeenCalledTimes(3);
    expect(window.history.state).toMatchObject({
      __NA: true, preserved: "router-state", caseCenterScrollTop: 912, caseCenterFocusClientId: otherClientId,
    });
  });

  it("restores the content scroller and focus to the currently visible authorized client", () => {
    window.history.replaceState({ __NA: true, caseCenterScrollTop: 912, caseCenterFocusClientId: clientId }, "", "/app/clients");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    const scrollWindow = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { container } = render(<><CaseCenterHistory />
      <CaseCenterWorkLink clientId={clientId} clientName="合成個案" href="/app/clients/work" />
    </>, { container: stage });
    const link = container.querySelector<HTMLElement>(`[data-case-client-id="${clientId}"]`)!;
    vi.spyOn(link, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    stage.scrollTop = 0;
    window.dispatchEvent(new Event("pageshow"));
    expect(stage.scrollTop).toBe(912);
    expect(document.activeElement).toBe(link);
    expect(scrollWindow).not.toHaveBeenCalled();
  });

  it("does not restore an old scroll position onto another client's new list", () => {
    window.history.replaceState({ __NA: true, caseCenterScrollTop: 912, caseCenterFocusClientId: clientId }, "", "/app/clients");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    render(<><CaseCenterHistory />
      <CaseCenterWorkLink clientId="02000000-0000-4000-8000-000000000099" clientName="目前授權個案" href="/app/clients/work" />
    </>, { container: stage });
    expect(stage.scrollTop).toBe(0);
    expect(document.activeElement).not.toHaveAttribute("data-case-client-id", clientId);
  });

  it("waits for the newly authorized list after popstate before restoring a return target", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const oldClientId = "02000000-0000-4000-8000-000000000099";
    const view = render(<><CaseCenterHistory readyKey="old-list" />
      <CaseCenterWorkLink clientId={oldClientId} clientName="舊個案" href="/app/clients/old" />
    </>, { container: stage });
    frames.shift()?.(0);
    frames.shift()?.(0);

    window.history.replaceState({ __NA: true, caseCenterScrollTop: 912, caseCenterFocusClientId: clientId }, "", "/app/clients");
    stage.scrollTop = 73;
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(stage.scrollTop).toBe(73);
    expect(frames).toHaveLength(0);

    view.rerender(<><CaseCenterHistory readyKey="new-list" />
      <CaseCenterWorkLink clientId={clientId} clientName="目前授權個案" href="/app/clients/new" />
    </>);
    const link = stage.querySelector<HTMLElement>(`[data-case-client-id="${clientId}"]`)!;
    vi.spyOn(link, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    frames.shift()?.(0);
    frames.shift()?.(0);
    expect(stage.scrollTop).toBe(912);
    expect(document.activeElement).toBe(link);
  });

  it("scrolls a restored focus target above the mobile navigation safe inset", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    window.history.replaceState({ __NA: true, caseCenterScrollTop: 912, caseCenterFocusClientId: clientId }, "", "/app/clients");
    const { container } = render(<><CaseCenterHistory />
      <CaseCenterWorkLink clientId={clientId} clientName="合成個案" href="/app/clients/work" />
    </>, { container: stage });
    const link = container.querySelector<HTMLElement>(`[data-case-client-id="${clientId}"]`)!;
    vi.spyOn(link, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    stage.style.scrollPaddingBottom = "92px";
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ top: 56, bottom: 560 } as DOMRect);
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue({ top: 470, bottom: 514 } as DOMRect);
    const scrollIntoView = vi.fn();
    link.scrollIntoView = scrollIntoView;
    frames.shift()?.(0);
    frames.shift()?.(0);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("keeps a clicked return position when the old list unmounts after scroll resets", () => {
    const view = render(<><CaseCenterHistory />
      <CaseCenterWorkLink clientId={clientId} clientName="合成個案" href="/app/clients/work" />
    </>, { container: stage });
    const link = screen.getByRole("link", { name: "進入個案工作" });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(window.history.state.caseCenterScrollTop).toBe(456);
    stage.scrollTop = 0;
    view.unmount();
    expect(window.history.state.caseCenterScrollTop).toBe(456);
  });
});
