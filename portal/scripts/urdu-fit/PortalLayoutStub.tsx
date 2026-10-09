import type { ReactNode } from 'react';

/** bd-fmf24g.24 — the harness's stand-in for PortalLayout (auth, queries, the menu): children only. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
