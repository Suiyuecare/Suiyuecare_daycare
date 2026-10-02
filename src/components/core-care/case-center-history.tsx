"use client";

import { ArrowRight } from "lucide-react";
import { useEffect } from "react";

type CaseCenterHistoryState = {
  caseCenterScrollTop?: unknown;
  caseCenterFocusClientId?: unknown;
};

function caseCenterScroller() {
  return document.querySelector<HTMLElement>(".main-stage");
}

function clientLink(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-case-client-id]")
    : null;
}

function savePosition(link?: HTMLElement | null) {
  const scroller = caseCenterScroller();
  if (!scroller) return;
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  const clientId = link?.dataset.caseClientId;
  const scrollTop = Math.max(0, Math.round(scroller.scrollTop));
  if (state.caseCenterScrollTop === scrollTop && (!clientId || state.caseCenterFocusClientId === clientId)) return;
  window.history.replaceState(
    {
      ...state,
      caseCenterScrollTop: scrollTop,
      ...(clientId ? { caseCenterFocusClientId: clientId } : {}),
    },
    "",
  );
}

export function CaseCenterHistory({ readyKey = "" }: { readyKey?: string }) {
  // App Router may deliver the new authorized list after popstate; restore
  // against the rendered list, never the outgoing page's DOM.
  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    const restorePosition = () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      const state = (window.history.state ?? {}) as CaseCenterHistoryState;
      const scrollTop =
        typeof state.caseCenterScrollTop === "number" &&
        Number.isFinite(state.caseCenterScrollTop)
          ? Math.max(0, state.caseCenterScrollTop)
          : null;
      const focusClientId =
        typeof state.caseCenterFocusClientId === "string"
          ? state.caseCenterFocusClientId
          : null;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          const scroller = caseCenterScroller();
          if (!scroller) return;
          const matchingLink = focusClientId
            ? [...scroller.querySelectorAll<HTMLElement>("[data-case-client-id]")].find((element) =>
                element.dataset.caseClientId === focusClientId && element.getClientRects().length > 0)
            : null;
          // A changed assignment or filter must not land on an unrelated row.
          if (scrollTop !== null) scroller.scrollTop = focusClientId && !matchingLink ? 0 : scrollTop;
          if (matchingLink) {
            matchingLink.focus({ preventScroll: true });
            const linkBounds = matchingLink.getBoundingClientRect();
            const stageBounds = scroller.getBoundingClientRect();
            const stageStyle = window.getComputedStyle(scroller);
            const topInset = Number.parseFloat(stageStyle.scrollPaddingTop) || 0;
            const bottomInset = Number.parseFloat(stageStyle.scrollPaddingBottom) || 0;
            if (linkBounds.top < stageBounds.top + topInset ||
                linkBounds.bottom > stageBounds.bottom - bottomInset) {
              matchingLink.scrollIntoView?.({ block: "nearest" });
            }
          }
        });
      });
    };
    restorePosition();
    const captureNavigation = (event: Event) => {
      const link = clientLink(event.target);
      if (link) savePosition(link);
    };
    const captureKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Enter") captureNavigation(event);
    };
    const capturePageHide = () => savePosition(clientLink(document.activeElement));

    document.addEventListener("click", captureNavigation, true);
    document.addEventListener("keydown", captureKeyboard, true);
    window.addEventListener("pagehide", capturePageHide);
    window.addEventListener("pageshow", restorePosition);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      document.removeEventListener("click", captureNavigation, true);
      document.removeEventListener("keydown", captureKeyboard, true);
      window.removeEventListener("pagehide", capturePageHide);
      window.removeEventListener("pageshow", restorePosition);
      // React may remove the old list and reset its scroller before this
      // cleanup runs. The link activation/pagehide has already saved the
      // position; overwriting it here would lose the return target.
    };
  }, [readyKey]);

  return null;
}

export function CaseCenterWorkLink({
  clientId,
  clientName,
  href,
  iconOnly = false,
}: {
  clientId: string;
  clientName: string;
  href: string;
  iconOnly?: boolean;
}) {
  return (
    <a
      aria-label={iconOnly ? `進入 ${clientName} 的個案工作` : undefined}
      className={iconOnly ? "icon-button" : "record-card__action"}
      data-case-client-id={clientId}
      href={href}
      onClick={(event) => savePosition(event.currentTarget)}
      onPointerDown={(event) => savePosition(event.currentTarget)}
    >
      {!iconOnly && "進入個案工作"}
      <ArrowRight aria-hidden="true" />
    </a>
  );
}
