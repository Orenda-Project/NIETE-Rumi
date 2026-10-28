import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import wordmark from "@/assets/niete-logo-white.png";
import type { NavItem } from "./NavBar";

/**
 * bd-sex15q.42 — the laptop rail (≥ 1024, DESIGN_SYSTEM §7, A's 240 px rail): the bilingual NIETE wordmark at 64 px,
 * the menu (the current item a green-tint pill with a green-ink label), then at its foot the language toggle and the
 * trust line, over the lattice at a whisper. Fixed to the inline start; the Shell keeps 240 px clear for it.
 * (`niete-logo-white.png` is the colour wordmark for a light ground, despite its name: same bytes as the brand's
 * `niete-wordmark-color-onlight.png`.)
 */
export function Rail({ items, ariaLabel, testId, logoAlt, extra, lang, trust }: {
  items: readonly NavItem[]; ariaLabel: string; testId: string; logoAlt: string; extra?: ReactNode; lang?: ReactNode; trust?: ReactNode;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      data-testid={testId}
      className="cp cp-rail-lattice fixed inset-y-0 start-0 z-40 hidden w-[240px] flex-col border-e border-cp-hairline bg-white px-5 pb-7 pt-7 lg:flex"
    >
      <div className="px-1 pb-6">
        <img src={wordmark} alt={logoAlt} className="block h-16 w-auto" />
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map(({ key, to, label, icon, current, dataNav }) => (
          <Link
            key={key}
            to={to}
            data-nav={dataNav}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-[44px] items-center gap-3 whitespace-nowrap rounded-[10px] px-3 text-[15px] outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green ${current ? "bg-cp-green-tint font-semibold text-cp-green-ink [&_svg]:text-cp-green" : "font-medium text-cp-ink-2 hover:bg-cp-ground hover:text-cp-ink"}`}
          >
            {icon}
            <span>{label}</span>
          </Link>
        ))}
        {extra}
      </div>
      <div className="mt-auto flex flex-col gap-4 pt-6">
        {lang}
        {trust && <p className="text-[13px] leading-[1.45] text-cp-ink-3">{trust}</p>}
      </div>
    </nav>
  );
}
