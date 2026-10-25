import { useSyncExternalStore } from "react";

/**
 * The look's band has two shapes: "two" rows (the mark, the date and school, the language pill;
 * then the greeting on a line of its own) when the greeting fits on one line, else "one" row (the mark, the greeting,
 * the pill). Under 344 px it is always one row.
 *
 * The width is an ESTIMATE of the greeting at the band's sizes, not a measurement: 10.5 px per code point in English
 * (20 px semibold); in Urdu 8 px per Urdu code point and 7 px per Latin one (a Latin name is set at 0.7em). A miss costs
 * one wrapped line, never a cut name: the band grows with its greeting.
 */
export type BandShape = "one" | "two";

/** Any strong right-to-left character (Urdu, Arabic, Hebrew and their presentation forms). */
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/** A strong left-to-right character: a Latin letter or a digit. */
const LTR = /[A-Za-z0-9\u00C0-\u024F]/;

/**
 * The greeting's estimated width in px. In Urdu a space or a mark takes the side of the strong character before it
 * (or after it, at the start): "، " is Urdu, "Testwala!" is Latin to its "!".
 */
export function titleWidth(title: string, lang: "en" | "ur"): number {
  const cps = [...title];
  if (lang !== "ur") return cps.length * 10.5;
  const firstStrong = cps.find((c) => RTL.test(c) || LTR.test(c));
  let latin = !!firstStrong && LTR.test(firstStrong);
  let px = 0;
  for (const c of cps) {
    if (RTL.test(c)) latin = false;
    else if (LTR.test(c)) latin = true;
    px += latin ? 7 : 8;
  }
  return px;
}

/** "one" under 344 px or when the greeting is wider than the band's line (32 px of side padding, 2 px of slack). */
export function bandShape(title: string, lang: "en" | "ur", vw: number): BandShape {
  return vw < 344 || titleWidth(title, lang) > vw - 32 - 2 ? "one" : "two";
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The page's width; the window's when the page reports 0 (a test DOM lays nothing out). */
function width(): number {
  if (typeof document === "undefined") return 360;
  return document.documentElement.clientWidth || window.innerWidth || 360;
}
/** No page to measure (a server render): the reference phone, 360 px. */
const serverWidth = () => 360;

/** The viewport's width in px, read on mount and again on every resize, so a rotation re-decides the band's shape. */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, width, serverWidth);
}
