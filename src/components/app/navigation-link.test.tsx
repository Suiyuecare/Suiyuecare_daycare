// @vitest-environment jsdom

import type { ComponentProps, MouseEvent } from "react";
import type Link from "next/link";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavigationLink } from "./navigation-link";

type NextLinkProps = ComponentProps<typeof Link>;
const nextLink = vi.hoisted(() => ({
  pendingByHref: new Map<string, boolean>(),
  render: vi.fn(),
}));
const mainFixtures: HTMLElement[] = [];

function createMainFixture(className: string, inert = false, busy: string | null = null) {
  const main = document.createElement("main");
  main.className = className;
  main.inert = inert;
  if (busy !== null) main.setAttribute("aria-busy", busy);
  const draft = document.createElement("input");
  draft.value = "synthetic unsent draft";
  main.append(draft);
  document.body.append(main);
  mainFixtures.push(main);
  return { main, draft };
}

vi.mock("next/link", async () => {
  const { createContext, useContext } = await import("react");
  const LinkContext = createContext<{ pending: boolean } | null>(null);
  return {
    default: function MockNextLink(props: NextLinkProps) {
      nextLink.render(props);
      const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
      return <LinkContext.Provider value={{ pending: nextLink.pendingByHref.get(href) ?? false }}>
        <a href={href} onClick={props.onClick} className={props.className}
          aria-current={props["aria-current"]} aria-label={props["aria-label"]}
          aria-describedby={props["aria-describedby"]} title={props.title}
          target={props.target} rel={props.rel}>{props.children}</a>
      </LinkContext.Provider>;
    },
    useLinkStatus: () => {
      const context = useContext(LinkContext);
      if (!context) throw new Error("useLinkStatus must remain a Link descendant");
      return context;
    },
  };
});

afterEach(() => {
  cleanup();
  for (const fixture of mainFixtures.splice(0)) fixture.remove();
  nextLink.pendingByHref.clear();
  nextLink.render.mockClear();
  vi.restoreAllMocks();
});

describe.each(["main-stage", "family-main"])("NavigationLink protects .%s while navigation is pending", (className) => {
  const firstHref = "/app/staff/daily-care/vital-signs";
  const secondHref = "/app/staff/governance/integrations-audit";
  const singleLink = () => <NavigationLink href={firstHref} loadingLabel="工作頁面">工作頁面</NavigationLink>;
  const twoLinks = () => <>
    <NavigationLink href={firstHref} loadingLabel="生命徵象">生命徵象</NavigationLink>
    <NavigationLink href={secondHref} loadingLabel="整合稽核">整合稽核</NavigationLink>
  </>;

  it("leaves idle main content and its existing busy state untouched", () => {
    const { main, draft } = createMainFixture(className, false, "false");
    render(singleLink());
    expect(main.inert).toBe(false);
    expect(main.getAttribute("aria-busy")).toBe("false");
    expect(draft.value).toBe("synthetic unsent draft");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    { inert: false, busy: null },
    { inert: false, busy: "false" },
    { inert: true, busy: "true" },
  ])("restores inert=$inert and aria-busy=$busy after idle and unmount", ({ inert, busy }) => {
    const { main, draft } = createMainFixture(className, inert, busy);
    nextLink.pendingByHref.set(firstHref, true);
    const { rerender, unmount } = render(singleLink());
    expect(main.inert).toBe(true);
    expect(main.getAttribute("aria-busy")).toBe("true");
    expect(main.contains(screen.getByRole("status"))).toBe(false);

    nextLink.pendingByHref.set(firstHref, false);
    rerender(singleLink());
    expect(main.inert).toBe(inert);
    expect(main.getAttribute("aria-busy")).toBe(busy);
    expect(main.contains(draft)).toBe(true);
    expect(draft.value).toBe("synthetic unsent draft");
    expect(screen.queryByRole("status")).toBeNull();

    nextLink.pendingByHref.set(firstHref, true);
    rerender(singleLink());
    expect(main.inert).toBe(true);
    expect(main.getAttribute("aria-busy")).toBe("true");
    unmount();
    expect(main.inert).toBe(inert);
    expect(main.getAttribute("aria-busy")).toBe(busy);
    expect(draft.value).toBe("synthetic unsent draft");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps protection during a last-link-wins handoff in either DOM order", () => {
    const { main } = createMainFixture(className);
    nextLink.pendingByHref.set(firstHref, true);
    const { rerender } = render(twoLinks());
    expect(main.inert).toBe(true);

    nextLink.pendingByHref.set(firstHref, false);
    nextLink.pendingByHref.set(secondHref, true);
    rerender(twoLinks());
    expect(main.inert).toBe(true);
    expect(main.getAttribute("aria-busy")).toBe("true");
    expect(screen.getAllByRole("status")).toHaveLength(1);

    nextLink.pendingByHref.set(secondHref, false);
    nextLink.pendingByHref.set(firstHref, true);
    rerender(twoLinks());
    expect(main.inert).toBe(true);
    expect(main.getAttribute("aria-busy")).toBe("true");
    expect(screen.getAllByRole("status")).toHaveLength(1);

    nextLink.pendingByHref.set(firstHref, false);
    rerender(twoLinks());
    expect(main.inert).toBe(false);
    expect(main.getAttribute("aria-busy")).toBeNull();
  });

  it("does not release or strand main protection if pending lifetimes briefly overlap", () => {
    const { main } = createMainFixture(className);
    nextLink.pendingByHref.set(firstHref, true);
    const { rerender } = render(twoLinks());
    nextLink.pendingByHref.set(secondHref, true);
    rerender(twoLinks());
    expect(main.inert).toBe(true);

    nextLink.pendingByHref.set(firstHref, false);
    rerender(twoLinks());
    expect(main.inert).toBe(true);
    expect(main.getAttribute("aria-busy")).toBe("true");
    nextLink.pendingByHref.set(secondHref, false);
    rerender(twoLinks());
    expect(main.inert).toBe(false);
    expect(main.getAttribute("aria-busy")).toBeNull();
  });
});

describe("NavigationLink delegates navigation and tracks only Next pending state", () => {
  const href = "/app/staff/daily-care/vital-signs";

  it("keeps idle links visible without mounting a loading indicator", () => {
    render(<NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>);
    expect(screen.getByRole("link", { name: "生命徵象紀錄" }).getAttribute("href")).toBe(href);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("portals the pending loader to body outside the anchor and transformed shell container", () => {
    nextLink.pendingByHref.set(href, true);
    const { container } = render(<NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>);
    const status = screen.getByRole("status");
    const link = screen.getByRole("link", { name: "生命徵象紀錄" });
    expect(status.textContent).toContain("正在載入生命徵象紀錄");
    expect(status.parentElement).toBe(document.body);
    expect(container.contains(status)).toBe(false);
    expect(link.contains(status)).toBe(false);
    expect(status.classList.contains("module-loading--transition")).toBe(true);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-busy")).toBe("true");
  });

  it("removes the portal immediately when Next returns to idle", () => {
    const view = <NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>;
    const { rerender } = render(view);
    nextLink.pendingByHref.set(href, true);
    rerender(<NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>);
    const status = screen.getByRole("status");
    nextLink.pendingByHref.set(href, false);
    rerender(<NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.contains(status)).toBe(false);
    expect(screen.getByRole("link", { name: "生命徵象紀錄" }).getAttribute("href")).toBe(href);
  });

  it("cleans up a pending portal when the originating link unmounts", () => {
    nextLink.pendingByHref.set(href, true);
    const { unmount } = render(<NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>);
    const status = screen.getByRole("status");
    unmount();
    expect(document.body.contains(status)).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not invent percentages for navigation with an unknown completion time", () => {
    nextLink.pendingByHref.set(href, true);
    render(<NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>);
    expect(screen.getByRole("status").textContent).not.toMatch(/\d+(?:\.\d+)?\s*[%％]|百分之/u);
    const progress = screen.getByRole("progressbar", { name: "系統功能載入中" });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.hasAttribute("aria-valuetext")).toBe(false);
  });

  it("preserves the href, children, callback identity and accessibility attributes", () => {
    const onClick = vi.fn((event: MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    render(<NavigationLink href={`${href}?date=2026-09-08#records`} loadingLabel="生命徵象紀錄"
      onClick={onClick} className="nav-link" aria-current="page" aria-label="查看生命徵象"
      aria-describedby="navigation-help" title="生命徵象入口">
      <span>生命徵象紀錄</span>
    </NavigationLink>);
    const link = screen.getByRole("link", { name: "查看生命徵象" });
    expect(link.getAttribute("href")).toBe(`${href}?date=2026-09-08#records`);
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("aria-describedby")).toBe("navigation-help");
    expect(link.getAttribute("title")).toBe("生命徵象入口");
    expect(link.className).toBe("nav-link");
    expect(link.querySelector("span")?.textContent).toBe("生命徵象紀錄");
    expect(nextLink.render.mock.calls.at(-1)?.[0].onClick).toBe(onClick);
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].defaultPrevented).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("passes object href and native Next navigation options through without rewriting them", () => {
    const objectHref = { pathname: "/family/schedule", query: { client: "synthetic-client" }, hash: "today" };
    const onNavigate = vi.fn();
    render(<NavigationLink href={objectHref} loadingLabel="行程" onNavigate={onNavigate}
      prefetch={false} replace scroll={false} target="_blank" rel="noopener noreferrer">行程</NavigationLink>);
    const passed = nextLink.render.mock.calls.at(-1)?.[0];
    expect(passed.href).toBe(objectHref);
    expect(passed.onNavigate).toBe(onNavigate);
    expect(passed.prefetch).toBe(false);
    expect(passed.replace).toBe(true);
    expect(passed.scroll).toBe(false);
    expect(passed.loadingLabel).toBeUndefined();
    const link = screen.getByRole("link", { name: "行程" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("follows per-link pending changes without leaving a previous overlay behind", () => {
    const secondHref = "/app/staff/governance/integrations-audit";
    const links = () => <>
      <NavigationLink href={href} loadingLabel="生命徵象紀錄">生命徵象紀錄</NavigationLink>
      <NavigationLink href={secondHref} loadingLabel="整合稽核">整合稽核</NavigationLink>
    </>;
    nextLink.pendingByHref.set(href, true);
    const { rerender } = render(links());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("正在載入生命徵象紀錄");
    nextLink.pendingByHref.set(href, false);
    nextLink.pendingByHref.set(secondHref, true);
    rerender(links());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("正在載入整合稽核");
    expect(screen.queryByText("正在載入生命徵象紀錄")).toBeNull();
  });
});
