import { createElement, type ComponentProps, type ReactNode } from "react";

// Browser-only fixture adapters. These never enter an application route.
export function useLinkStatus() { return { pending: false }; }
export default function FixtureLink({ href, children, prefetch: _prefetch, scroll: _scroll, replace: _replace, onNavigate: _onNavigate, ...props }: ComponentProps<"a"> & { href: string; children?: ReactNode; prefetch?: boolean; scroll?: boolean; replace?: boolean; onNavigate?: unknown }) {
  void _prefetch; void _scroll; void _replace; void _onNavigate;
  return createElement("a", { ...props, href, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { props.onClick?.(event); event.preventDefault(); } }, children);
}
export function FixtureImage({ unoptimized: _unoptimized, ...props }: ComponentProps<"img"> & { unoptimized?: boolean }) {
  void _unoptimized;
  return createElement("img", props);
}
