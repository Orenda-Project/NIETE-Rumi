import { useLang } from "../../../teacher/i18n";
import { t } from "../text";
import type { LoadError } from "../api";

/**
 * bd-sex15q.15 — the one block for a screen that has nothing to show yet or could not load (COPY §E). A failed state
 * never wears a pending label (B10 add): each error kind has its own words. Loading is a quiet outline, no words.
 */
/** COPY e.failed_load says "Pull down to try again": the page reloads on pull, so the block carries no button of its own. */
export function StateBlock({ error, testId = "insights-state" }: { error: LoadError | null; testId?: string }) {
  const lang = useLang();
  if (!error) {
    return <div data-testid={`${testId}-loading`} aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-white/70" />;
  }
  const key = error === "not_found" ? "e.404" : error === "signed_out" ? "e.401" : error === "offline" ? "e.offline" : "e.failed_load";
  return (
    <div role="status" data-testid={testId} data-state={error} className="rounded-2xl border border-[#e5e7eb] bg-white px-4 py-5 text-[15px] text-[#374151]">
      <p>{t(key, lang)}</p>
    </div>
  );
}

/** A plain message card for a payload state (Empty, stale, insufficient): words from COPY, numbers already marked. */
export function NoteCard({ children, tone = "neutral", testId }: { children: React.ReactNode; tone?: "neutral" | "info"; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={tone === "info"
        ? "rounded-2xl bg-[#eef2ff] px-4 py-3.5 text-[15px] leading-snug text-[#312e81]"
        : "rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 text-[15px] leading-snug text-[#374151]"}
    >
      {children}
    </div>
  );
}
