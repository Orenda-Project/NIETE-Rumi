import type { ReactNode } from "react";

/**
 * bd-sex15q.42 — a hairline section (DESIGN_SYSTEM §3, A's page): a 12 px small-caps label (green-ink when it names
 * what needs the coach, ink-3 otherwise), an optional hint, then its rows; a 1 px hairline above it unless it is the
 * first thing on the page. Urdu: no caps, no tracking, 13 px (tokens.css). `title` is an h2 for a section that is a
 * heading rather than a label.
 */
export function Section({ label, title, hint, tone = "grey", first = false, children, testId, className, action }: {
  label?: ReactNode; title?: ReactNode; hint?: ReactNode; tone?: "grey" | "green"; first?: boolean; children?: ReactNode;
  testId?: string; className?: string; action?: ReactNode;
}) {
  return (
    <section data-testid={testId} data-section="" className={`${first ? "" : "mt-5 border-t border-cp-hairline"} pt-6 ${className ?? ""}`}>
      {(label || title || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {label && (
              <p className={`cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] ${tone === "green" ? "text-cp-green-ink" : "text-cp-ink-3"}`}>{label}</p>
            )}
            {title && <h2 className="text-[20px] font-bold leading-[1.3] text-cp-navy">{title}</h2>}
            {hint && <p className="mt-1 text-[13px] leading-[1.45] text-cp-ink-3">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children && <div className={label || title || hint ? "mt-2" : ""}>{children}</div>}
    </section>
  );
}
