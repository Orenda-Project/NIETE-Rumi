import { useLang } from "../../../teacher/i18n";
import { t } from "../text";
import type { LoadError } from "../api";
import { Skeleton } from "../../../coachip-ui/Skeleton";

/**
 * bd-sex15q.15 — the one block for a screen that has nothing to show yet or could not load (COPY §E). A failed state
 * never wears a pending label (B10 add): each error kind has its own words. Loading is the page's final layout with
 * no words (coachip-ui Skeleton: a ring row and three rows, fixed heights), so nothing jumps when the data lands.
 * Used by every RM page too.
 */
/** COPY e.failed_load says "Pull down to try again": the page reloads on pull, so the block carries no button of its own. */
export function StateBlock({ error, testId = "insights-state" }: { error: LoadError | null; testId?: string }) {
  const lang = useLang();
  if (!error) {
    return <Skeleton testId={`${testId}-loading`} />;
  }
  const key = error === "not_found" ? "e.404" : error === "signed_out" ? "e.401" : error === "offline" ? "e.offline" : "e.failed_load";
  return (
    <div role="status" data-testid={testId} data-state={error} className="rounded-[20px] border border-cp-hairline bg-cp-surface px-5 py-5 text-[15px] leading-[1.45] text-cp-ink-2">
      <p>{t(key, lang)}</p>
    </div>
  );
}

/**
 * A plain message for a payload state (Empty, stale, insufficient): words from COPY, numbers already marked. `info`
 * (stale) is navy-tint text, never indigo or amber (DESIGN_SYSTEM §6: nothing shouts); `neutral` a quiet white note.
 * The RM's RmNote is this.
 */
export function NoteCard({ children, tone = "neutral", testId }: { children: React.ReactNode; tone?: "neutral" | "info"; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={tone === "info"
        ? "rounded-[16px] bg-cp-navy-tint px-4 py-3.5 text-[15px] leading-[1.45] text-cp-navy"
        : "rounded-[16px] border border-cp-hairline bg-cp-surface px-4 py-3.5 text-[15px] leading-[1.45] text-cp-ink-2"}
    >
      {children}
    </div>
  );
}
