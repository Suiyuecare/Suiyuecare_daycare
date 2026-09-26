"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";

export type GovernanceDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  busy?: boolean;
  onRequestClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

function outsideSurface(dialog: HTMLDialogElement, x: number, y: number) {
  const bounds = dialog.getBoundingClientRect();
  return x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom;
}

/** Controlled confirmation surface: a request to cancel never closes it itself. */
export function GovernanceDialog({
  open,
  title,
  children,
  busy = false,
  onRequestClose,
  returnFocusRef,
}: GovernanceDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pointerStartedOutside = useRef<boolean | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const originalFocus = returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusScope = originalFocus?.closest("section");

    // Do not fall back to `open`: only showModal supplies native background inertness.
    if (!dialog.open) dialog.showModal();
    if (cancelRef.current && !cancelRef.current.disabled) cancelRef.current.focus();
    else titleRef.current?.focus();

    return () => {
      // React StrictMode replays effects; close exactly once for each native open cycle.
      if (!dialog.open) return;
      dialog.close();
      pointerStartedOutside.current = null;
      // A committed proposal can disable its old trigger; use a real target in
      // the same workspace rather than claiming restoration on a disabled one.
      if (originalFocus?.isConnected && !originalFocus.matches(":disabled") &&
          originalFocus.getAttribute("aria-disabled") !== "true" && !originalFocus.closest("[hidden], [inert]")) {
        originalFocus.focus();
        if (document.activeElement === originalFocus) return;
      }
      const anchor = focusScope?.querySelector<HTMLElement>("[data-governance-focus-anchor]");
      if (anchor?.isConnected) anchor.focus();
    };
  }, [open, returnFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    // Recheck after every render: an in-flight phase can replace the focused
    // child while busy stays true, and Chrome then leaves focus on BODY.
    if (!busy || !open || !dialog?.open) return;
    const keepFocusInside = () => {
      if (dialog.isConnected && dialog.open && (document.activeElement === cancelRef.current ||
          document.activeElement?.matches(":disabled") || !dialog.contains(document.activeElement))) titleRef.current?.focus();
    };
    keepFocusInside();
    // The browser's click/default-focus step can run after the effect. One
    // cancellable frame catches that step without polling or stealing valid focus.
    const frame = window.requestAnimationFrame?.(keepFocusInside);
    return () => { if (frame !== undefined) window.cancelAnimationFrame?.(frame); };
  });

  function requestClose() {
    if (open && !busy) onRequestClose();
  }

  return (
    <dialog
      aria-busy={busy}
      aria-labelledby={titleId}
      aria-modal="true"
      className="core-dialog"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        const startedOutside = pointerStartedOutside.current;
        pointerStartedOutside.current = null;
        if (event.target === event.currentTarget && startedOutside !== false &&
            outsideSurface(event.currentTarget, event.clientX, event.clientY)) requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }}
      onPointerDown={(event) => {
        pointerStartedOutside.current = event.target === event.currentTarget &&
          outsideSurface(event.currentTarget, event.clientX, event.clientY);
      }}
      ref={dialogRef}
    >
      <div className="core-dialog__surface">
        <header className="drawer__header">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
          <button className="button button--secondary" disabled={busy} onClick={requestClose}
            ref={cancelRef} type="button">取消</button>
        </header>
        <div className="drawer__body core-dialog__body">{children}</div>
      </div>
    </dialog>
  );
}
