"use client";

import { useEffect, type ComponentProps } from "react";
import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { ModuleLoading } from "./module-loading";
import { DAILY_SERVICE_SUMMARY_PATH } from "@/lib/daily-service-summary/query";

const pendingMainLocks = new WeakMap<HTMLElement, {
  owners: number;
  inert: boolean;
  busy: string | null;
}>();

function NavigationPending({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    const main = document.querySelector<HTMLElement>(".main-stage, .family-main");
    if (!main) return;
    const lock = pendingMainLocks.get(main) ?? {
      owners: 0, inert: main.inert, busy: main.getAttribute("aria-busy"),
    };
    lock.owners += 1;
    pendingMainLocks.set(main, lock);
    main.inert = true;
    main.setAttribute("aria-busy", "true");
    return () => {
      lock.owners -= 1;
      if (lock.owners > 0) return;
      main.inert = lock.inert;
      if (lock.busy === null) main.removeAttribute("aria-busy");
      else main.setAttribute("aria-busy", lock.busy);
      pendingMainLocks.delete(main);
    };
  }, [pending]);
  // A portal keeps the loader outside transformed/closed mobile navigation and
  // prevents its status text from becoming part of the link's accessible name.
  return pending ? createPortal(<ModuleLoading title={`正在載入${label}`} transition />, document.body) : null;
}

/** Keep Next navigation for ordinary pages; isolate sensitive summary snapshots in a new document. */
export function NavigationLink({ children, loadingLabel, fullDocument = false, ...props }: ComponentProps<typeof Link> & {
  loadingLabel: string;
  fullDocument?: boolean;
}) {
  if (typeof props.href === "string" && (fullDocument || props.href === DAILY_SERVICE_SUMMARY_PATH ||
    props.href.startsWith(`${DAILY_SERVICE_SUMMARY_PATH}?`) ||
    props.href.startsWith(`${DAILY_SERVICE_SUMMARY_PATH}#`))) {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    delete anchorProps.scroll;
    delete anchorProps.replace;
    delete anchorProps.shallow;
    delete anchorProps.locale;
    delete anchorProps.legacyBehavior;
    delete anchorProps.passHref;
    delete anchorProps.as;
    delete anchorProps.onNavigate;
    return <a {...anchorProps} href={props.href}>{children}</a>;
  }
  return <Link {...props}>{children}<NavigationPending label={loadingLabel} /></Link>;
}
