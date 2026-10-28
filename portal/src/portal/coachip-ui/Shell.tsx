import { createContext, useContext, type ReactNode } from "react";
import "./tokens.css";

/**
 * FIX_R6 A4 (design-qa idea 224146): the id of the window the screen's band or app bar already states. A row whose own
 * window is this one draws no range line of its own (its `data-win` still resolves to the header's element), so a screen
 * says each window once.
 */
const ScreenWindow = createContext<string | null>(null);
export const useScreenWindow = () => useContext(ScreenWindow);

/**
 * bd-sex15q.42 — the frame of every COACHIP screen (DESIGN_SYSTEM §7): the `.cp` root the tokens are scoped under, the
 * header (a Band on a home, an AppBar on an inner screen) full-bleed on a phone, the page on the ground with a 20 px
 * gutter, the trust line at the foot. On a laptop (≥ 1024): 240 px kept clear for the Rail, the header and page in a
 * 720 px main column with an optional 320 px right column (`aside`), or the whole 1072 px width (`wide`, S8's grid).
 *
 * `nav` is drawn inside the root (the RM's menu); the coach's menu comes from PortalLayout (PortalNavigation →
 * InsightsNav), so a coach page passes none and `padBottom="layout"` (PortalLayout already clears the phone bar).
 */
export function Shell({ testId, header, nav, aside, wide = false, trust, trustInRail = false, padBottom = "self", fullHeight = true, bleed = false, dir, screenWindow = null, children }: {
  testId: string; header?: ReactNode; nav?: ReactNode; aside?: ReactNode; wide?: boolean; trust?: ReactNode; trustInRail?: boolean;
  padBottom?: "self" | "layout"; fullHeight?: boolean; bleed?: boolean; dir?: "ltr" | "rtl"; screenWindow?: string | null; children: ReactNode;
}) {
  const pad = padBottom === "self"
    ? "pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16"
    // PortalLayout pads 88 px under a phone only up to md; the bar shows up to lg
    : "pb-4 md:max-lg:pb-[calc(80px+env(safe-area-inset-bottom))] lg:pb-16";
  const cols = aside ? "lg:grid lg:grid-cols-[minmax(0,720px)_320px] lg:items-start lg:gap-x-8" : "";
  return (
    <ScreenWindow.Provider value={screenWindow}>
      <div
        data-testid={testId}
        data-cp-shell=""
        dir={dir}
        className={`cp bg-cp-ground text-cp-ink ${fullHeight ? "min-h-screen" : ""} ${bleed ? "-mx-4 -mt-4 md:-mx-6 lg:-mx-8" : ""}`}
      >
        {nav}
        <div className="lg:ps-[240px]">
          <div className={`mx-auto w-full max-w-[640px] lg:px-16 lg:pt-9 ${wide || aside ? "lg:max-w-[1200px]" : "lg:max-w-[848px]"}`}>
            <div className={`${cols} ${pad}`}>
              <div className="min-w-0">
                {header}
                <div className="cp-enter flex flex-col px-5 pt-4 lg:px-0 lg:pt-2">
                  {children}
                  {trust && <div data-cp-trust="" className={trustInRail ? "lg:hidden" : ""}>{trust}</div>}
                </div>
              </div>
              {aside && <aside data-cp-aside="" className="px-5 pt-6 lg:sticky lg:top-9 lg:px-0 lg:pt-12">{aside}</aside>}
            </div>
          </div>
        </div>
      </div>
    </ScreenWindow.Provider>
  );
}
