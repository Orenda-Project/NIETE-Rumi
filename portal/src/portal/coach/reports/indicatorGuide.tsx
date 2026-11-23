import { createContext, useContext } from "react";

/**
 * bd-o15qnr.37 (#204) — the "?" indicator guide (#217) as the Feedback Form sees it: whether it has an indicator, and how
 * to open that indicator in it. No provider (today): no guide, so no "Examples" link. #217 provides it on the coach and
 * principal observation pages.
 */
export type IndicatorGuide = {
  /** rubric: the draft's rubric id ("fico17_v6", "fico_s_v1_2", "fico_s_v1_1"); code: "C1", "A3", … */
  has: (rubric: string, code: string) => boolean;
  open: (rubric: string, code: string) => void;
};

export const IndicatorGuideContext = createContext<IndicatorGuide | null>(null);

export const useIndicatorGuide = (): IndicatorGuide | null => useContext(IndicatorGuideContext);
