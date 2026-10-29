import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * bd-sex15q.42 — a hairline row (DESIGN_SYSTEM §7): title 17/600, an optional meta line 13 px ink-3, an optional
 * leading node (a RowCount, an icon), and a chevron at the end when it goes somewhere (it flips in Urdu). At least 44 px
 * tall. Rows sit flush in a list: the hairline is between rows, never above the first.
 */
export function Row({ title, meta, lead, trail, to, onClick, testId, className, children, ...rest }: {
  title?: ReactNode; meta?: ReactNode; lead?: ReactNode; trail?: ReactNode; to?: string; onClick?: () => void;
  testId?: string; className?: string; children?: ReactNode;
} & { [k: `data-${string}`]: string | number | undefined }) {
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <span className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{title}</span>}
        {meta && <span className="text-[13px] leading-[1.45] text-cp-ink-3">{meta}</span>}
        {children}
      </span>
      {trail}
      {(to || onClick) && <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 self-center text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />}
    </>
  );
  const cls = `flex min-h-[44px] w-full items-start gap-3 border-t border-cp-hairline py-3.5 text-start first:border-t-0 ${className ?? ""}`;
  if (to) return <Link {...rest} to={to} data-testid={testId} className={`${cls} outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green`}>{body}</Link>;
  if (onClick) return <button {...rest} type="button" onClick={onClick} data-testid={testId} className={`${cls} outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green`}>{body}</button>;
  return <div {...rest} data-testid={testId} className={cls}>{body}</div>;
}
