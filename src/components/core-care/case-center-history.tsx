"use client";

import { ArrowRight } from "lucide-react";
import { useEffect } from "react";

type CaseCenterHistoryState = {
  caseCenterScrollY?: unknown;
  caseCenterFocusClientId?: unknown;
};

function clientLink(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-case-client-id]")
    : null;
}

function savePosition(link?: HTMLElement | null) {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  const clientId = link?.dataset.caseClientId;
  window.history.replaceState(
    {
      ...state,
      caseCenterScrollY: Math.max(0, Math.round(window.scrollY)),
      ...(clientId ? { caseCenterFocusClientId: clientId } : {}),
    },
    "",
  );
}

export function CaseCenterHistory() {
  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    const restorePosition = () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      const state = (window.history.state ?? {}) as CaseCenterHistoryState;
      const scrollY =
        typeof state.caseCenterScrollY === "number" &&
        Number.isFinite(state.caseCenterScrollY)
          ? Math.max(0, state.caseCenterScrollY)
          : null;
      const focusClientId =
        typeof state.caseCenterFocusClientId === "string"
          ? state.caseCenterFocusClientId
          : null;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (scrollY !== null) {
            window.scrollTo({ top: scrollY, behavior: "auto" });
          }
          if (focusClientId) {
            const matchingLink = [
              ...document.querySelectorAll<HTMLElement>(
                "[data-case-client-id]",
              ),
            ].find(
              (element) =>
                element.dataset.caseClientId === focusClientId &&
                element.getClientRects().length > 0,
            );
            matchingLink?.focus({ preventScroll: true });
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
    window.addEventListener("popstate", restorePosition);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      document.removeEventListener("click", captureNavigation, true);
      document.removeEventListener("keydown", captureKeyboard, true);
      window.removeEventListener("pagehide", capturePageHide);
      window.removeEventListener("pageshow", restorePosition);
      window.removeEventListener("popstate", restorePosition);
      savePosition(clientLink(document.activeElement));
    };
  }, []);

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
