import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ShellHint } from "../lib/shellHint";
import nieteLogo from "@/assets/niete-logo.png";

/**
 * bd-fxk3t8 — placeholder blocks, shown where data is still on its way instead of a spinner.
 *
 * The block style is index.html's (#app-shell-css, class `as-sk`): grey, and a shimmer only
 * for someone who has not asked for less motion. Using the same blocks means the page React
 * draws continues the outline the browser painted before the app arrived, with no jump.
 *
 * Every block carries `data-skeleton` and is hidden from screen readers; the region around
 * them says `aria-busy`.
 *
 *   SkeletonLine   a line of text          SkeletonChip  a pill
 *   SkeletonTile   a Home-style tile       SkeletonRow   a list row (icon, two lines)
 *   SkeletonList   n rows                  PageSkeleton  a page's title + tiles or rows
 *   FrameSkeleton  the whole app frame (menu bar, tab bar) around a PageSkeleton
 *   LoginSkeleton  the sign-in page: the auth frame's band and card
 */

const SK = "as-sk";

type Cls = { className?: string };

function Block({ className }: Cls) {
  return <div data-skeleton="" aria-hidden="true" className={cn(SK, className)} />;
}

export function SkeletonLine({ className }: Cls) {
  return <Block className={cn("h-3 w-2/3 rounded-full", className)} />;
}

export function SkeletonChip({ className }: Cls) {
  return <Block className={cn("h-8 w-24 rounded-full", className)} />;
}

export function SkeletonTile({ className }: Cls) {
  return (
    <div aria-hidden="true" className={cn("flex h-[116px] flex-col justify-between rounded-[18px] bg-white p-4", className)}>
      <Block className="h-10 w-10 rounded-xl" />
      <SkeletonLine className="w-3/5" />
    </div>
  );
}

export function SkeletonRow({ className }: Cls) {
  return (
    <div aria-hidden="true" className={cn("flex min-h-[72px] items-center gap-3 rounded-2xl bg-white px-4 py-3", className)}>
      <Block className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="flex flex-1 flex-col gap-2">
        <SkeletonLine className="w-1/2" />
        <SkeletonLine className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

/** `label` names what is loading for a screen reader (the region becomes a status). */
export function SkeletonList({ rows = 3, label, className }: Cls & { rows?: number; label?: string }) {
  return (
    <div
      aria-busy="true"
      {...(label ? { role: "status", "aria-label": label } : {})}
      className={cn("flex flex-col gap-3", className)}
    >
      {Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

/** A page's heading, then tiles (a home) or rows (a list). */
export function PageSkeleton({ kind = "tiles", className }: Cls & { kind?: "tiles" | "list" }) {
  return (
    <div aria-busy="true" className={className}>
      <Block className="mb-3 h-[26px] w-[46%] max-w-[320px] rounded-lg" />
      <Block className="mb-6 h-3.5 w-[30%] max-w-[200px] rounded-lg" />
      {kind === "tiles" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {Array.from({ length: 6 }, (_, i) => <SkeletonTile key={i} />)}
        </div>
      ) : (
        <SkeletonList rows={4} />
      )}
    </div>
  );
}

/** The desktop menu bar's place. */
export function TopBarSkeleton({ variant }: { variant: ShellHint }) {
  const teacher = variant === "teacher";
  return (
    <div
      data-nav-placeholder=""
      aria-hidden="true"
      className={cn("hidden h-16 md:block", teacher ? "border-b border-[#e5e7eb] bg-white" : "bg-[#333748]")}
    >
      <div className="mx-auto flex h-full max-w-[1152px] items-center gap-7 px-8">
        <Block className={cn("h-[22px] w-[104px]", !teacher && "bg-white/20")} />
        {Array.from({ length: 4 }, (_, i) => <Block key={i} className={cn("h-3 w-[72px]", !teacher && "bg-white/20")} />)}
      </div>
    </div>
  );
}

/** The phone tab bar's place. */
export function TabBarSkeleton({ variant }: { variant: ShellHint }) {
  return (
    <div
      data-nav-placeholder=""
      aria-hidden="true"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-[#e5e7eb] bg-white pb-[env(safe-area-inset-bottom)] md:hidden",
        variant === "teacher" ? "h-[78px]" : "h-16",
      )}
    >
      {Array.from({ length: 5 }, (_, i) => <Block key={i} className="h-[26px] w-[26px] rounded-[9px]" />)}
    </div>
  );
}

/**
 * The app's frame with placeholder blocks: what shows while the signed-in user (or the flag
 * that decides her frame) is read, instead of a white screen or a full-screen spinner.
 */
export function FrameSkeleton({ variant, bare = false, children }: { variant: ShellHint; bare?: boolean; children?: ReactNode }) {
  return (
    <div data-frame={variant} aria-busy="true" className="min-h-screen bg-[#f3f4f6]">
      {!bare && <TopBarSkeleton variant={variant} />}
      <main className="mx-auto max-w-[1152px] px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-12 md:pt-8">
        {children ?? <PageSkeleton />}
      </main>
      {!bare && <TabBarSkeleton variant={variant} />}
    </div>
  );
}

/**
 * The sign-in page's outline (bd-fmf24g.64): the auth frame with placeholder blocks, so the page React draws continues
 * the one index.html painted (an indigo band with the real N mark, one white card climbing into it). It shows for the
 * four signed-out pages while their chunk or the session is on its way.
 */
export function LoginSkeleton() {
  return (
    <div data-frame="login" aria-busy="true" className="min-h-screen bg-nu-surface">
      <div className="bg-nu-ink pb-[72px] pt-[calc(14px+env(safe-area-inset-top))]">
        <div className="mx-auto w-full max-w-[460px] px-5 md:max-w-[480px]">
          <div className="flex min-h-[56px] items-center gap-1.5">
            <img src={nieteLogo} alt="" aria-hidden="true" className="-ms-1.5 h-11 w-11 object-contain" />
            <Block className="h-3.5 w-24 rounded-full bg-nu-frame-translucent" />
          </div>
          <Block className="mt-[30px] h-9 w-1/2 rounded-xl bg-nu-frame-translucent" />
        </div>
      </div>
      <div className="relative -mt-10 px-4">
        <div aria-hidden="true" className="mx-auto w-full max-w-[460px] rounded-[20px] bg-nu-surface-card px-5 pb-6 pt-[22px] shadow-nu-float md:max-w-[480px]">
          <Block className="mb-2.5 h-4 w-2/5 rounded-full" />
          <Block className="mb-5 h-[58px] rounded-2xl" />
          <Block className="mb-2.5 h-4 w-1/3 rounded-full" />
          <Block className="mb-6 h-[58px] rounded-2xl" />
          <Block className="h-[58px] rounded-full bg-nu-button-disabled" />
        </div>
      </div>
    </div>
  );
}
