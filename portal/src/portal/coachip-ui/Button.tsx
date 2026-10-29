import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "lg" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  // navy label on brand green: 4.8:1 (white on green is 2.6:1 and fails AA; DIRECTION "Buttons")
  primary: "bg-cp-green text-cp-navy",
  secondary: "border-2 border-cp-navy bg-white text-cp-navy",
  quiet: "bg-transparent text-cp-green-ink",
};
const SIZE: Record<ButtonSize, string> = {
  lg: "min-h-[52px] rounded-[14px] px-5 text-[16px] font-bold",
  md: "min-h-[44px] rounded-[12px] px-4 text-[14px] font-semibold",
};

/**
 * bd-sex15q.42 — the button (DESIGN_SYSTEM §7). ONE primary per screen: 52 px, green fill, navy label. Secondary: navy
 * outline on white. `md` is the 44 px small button (Follow-up, a row's action). A `to` makes it a Link (a route), an
 * `href` a plain anchor (`#moment`), otherwise a button. Its label is one inline run: pass an element, not loose text
 * beside an element (a flex box trims the space at a bare run's edge, ThisWeek.test "one inline run").
 */
export function Button({ children, variant = "primary", size = "lg", block = false, to, href, onClick, disabled, type = "button", testId, className, icon, ...rest }: {
  children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; block?: boolean; to?: string; href?: string;
  onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; testId?: string; className?: string; icon?: ReactNode;
} & { [k: `data-${string}` | `aria-${string}`]: string | number | boolean | undefined }) {
  const cls = `cp-press inline-flex items-center justify-center gap-2 whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-cp-navy focus-visible:ring-offset-2 disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${block ? "w-full" : ""} ${className ?? ""}`;
  const body = <>{icon}{children}</>;
  if (to) return <Link {...rest} to={to} data-testid={testId} className={cls}>{body}</Link>;
  if (href) return <a {...rest} href={href} data-testid={testId} className={cls}>{body}</a>;
  return <button {...rest} type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={cls}>{body}</button>;
}
