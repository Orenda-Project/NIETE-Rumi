/**
 * bd-sex15q.34 — a teacher's first screen starts downloading with the app, not after it.
 *
 * The teacher dashboard (and the teacher app's Home) are their own chunks, so a coach's first open does not wait
 * for them. A page in its own chunk is normally asked for only once the router reaches it, one round trip after
 * the app's chunk arrives. For the screen a teacher opens first ("/" on a device that was signed in, or the
 * dashboard itself), that request goes out at boot, alongside everything else, so a teacher waits no longer than
 * before. A wrong guess costs one background download; it decides nothing (the router and the gates still do).
 */
import type { ShellHint } from "@/portal/lib/shellHint";

export type FirstScreenLoaders = { dashboard: () => Promise<unknown>; teacherHome: () => Promise<unknown> };

export function warmFirstScreen(pathname: string, hint: ShellHint | null, load: FirstScreenLoaders): void {
  const path = pathname.replace(/\/+$/, "") || "/";
  const dashboard = path === "/portal/dashboard";
  // "/" with no hint is a signed-out device: it is going to the sign-in page, which is in the app's own chunk.
  if (!dashboard && !(path === "/" && hint !== null)) return;
  load.dashboard().catch(() => undefined);
  if (hint === "teacher") load.teacherHome().catch(() => undefined);
}
