"use client";

import { useEffect, type ComponentProps } from "react";
import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { ModuleLoading } from "./module-loading";

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

/** Keep Next's native cancellation, modifier keys, prefetch and error lifecycle. */
export function NavigationLink({ children, loadingLabel, ...props }: ComponentProps<typeof Link> & { loadingLabel: string }) {
  return <Link {...props}>{children}<NavigationPending label={loadingLabel} /></Link>;
}
