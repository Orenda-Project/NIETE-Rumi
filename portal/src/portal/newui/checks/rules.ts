/**
 * bd-5rz1v.19 — the new UI's design rules as functions the tests (checks/*.test.*) call.
 * DESIGN.md says what each rule is for; this file says exactly what passes.
 */
import { TAP_MIN_PX } from '../tokens';

/* ── copy: a label, never a sentence ─────────────────────────────────────── */

/** "1–3 words" is the aim (DESIGN.md); four is the most the check lets through. */
export const MAX_WORDS = 4;

/** Ends like a sentence: . ? ! and the Urdu full stop ۔ and question mark ؟ (… is fine). */
const SENTENCE_END = /[.?!؟۔]$/u;

/**
 * Strings allowed to break the rule, each with its reason. Keep it short: an entry here is a
 * sentence on a teacher's screen. Empty today.
 */
export const COPY_ALLOWLIST: ReadonlyArray<{ text: string; why: string }> = [];

/** Words, not punctuation: "Training · NIETE · Level 2" is 4 words, "—" is none. */
export function words(text: string): string[] {
  return text.trim().split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Why `text` is not a label, or null when it is fine. */
export function copyProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (COPY_ALLOWLIST.some((a) => a.text === t)) return null;
  if (SENTENCE_END.test(t)) return `ends like a sentence ("${t.slice(-1)}")`;
  const n = words(t).length;
  if (n > MAX_WORDS) return `${n} words (at most ${MAX_WORDS})`;
  return null;
}

/** Arguments every copy function is called with, so what it RETURNS is linted too. */
const SAMPLE_ARGS: unknown[][] = [[], [1], [12], ['Ayesha']];

/** Every string in a copy object, with its path; a function contributes what it returns. */
export function collectCopy(value: unknown, path = ''): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (typeof value === 'function') {
    const out: Array<{ path: string; text: string }> = [];
    for (const args of SAMPLE_ARGS) {
      let r: unknown;
      try { r = (value as (...a: unknown[]) => unknown)(...args); } catch { continue; }
      if (typeof r === 'string') out.push({ path: `${path}(${args.map((a) => JSON.stringify(a)).join(', ')})`, text: r });
    }
    return out;
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => collectCopy(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => collectCopy(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/* ── taps: at least 56px ─────────────────────────────────────────────────── */

/** Tailwind's spacing scale, for h-14 / w-16 and friends (4px a step). */
const scale = (n: string) => Number(n) * 4;

/** The phone's own classes: a class behind md:/lg:/hover: does not make a phone target big. */
function baseClasses(className: string): string[] {
  return className.split(/\s+/).filter((c) => c && !/^[\w-]+:/.test(c));
}

function pxOf(cls: string, prefixes: string[]): number | null {
  for (const p of prefixes) {
    const arb = cls.match(new RegExp(`^${p}-\\[(\\d+(?:\\.\\d+)?)px\\]$`));
    if (arb) return Number(arb[1]);
    const step = cls.match(new RegExp(`^${p}-(\\d+(?:\\.\\d+)?)$`));
    if (step) return scale(step[1]);
  }
  return null;
}

export function tapHeightOk(className: string): boolean {
  return baseClasses(className).some((c) => (pxOf(c, ['min-h', 'h', 'size']) ?? 0) >= TAP_MIN_PX);
}

export function tapWidthOk(className: string): boolean {
  return baseClasses(className).some((c) => c === 'w-full' || c === 'flex-1' || (pxOf(c, ['min-w', 'w', 'size']) ?? 0) >= TAP_MIN_PX);
}

/**
 * What a finger can reach. An element with the `hidden` attribute is not on screen — a file
 * input that a row's tap opens (bd-5rz1v.26) — so it is not a target.
 */
export const INTERACTIVE = [
  'button', 'a[href]', 'input:not([type="hidden"]):not([hidden])', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="radio"]', '[role="checkbox"]', '[role="tab"]', '[role="switch"]',
].join(', ');

function name(el: Element): string {
  const label = el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('type') || '';
  return `${el.tagName.toLowerCase()} "${label.slice(0, 40)}"`;
}

/**
 * Every interactive element under `root` that is not a 56px target, described. An element with
 * no text (an icon alone) must be 56px wide as well as tall.
 */
export function tapProblems(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll(INTERACTIVE).forEach((el) => {
    const cls = el.getAttribute('class') || '';
    if (!tapHeightOk(cls)) out.push(`${name(el)}: height under ${TAP_MIN_PX}px (${cls || 'no class'})`);
    else if (!(el.textContent || '').trim() && el.tagName !== 'INPUT' && !tapWidthOk(cls)) {
      out.push(`${name(el)}: width under ${TAP_MIN_PX}px for an icon alone (${cls})`);
    }
  });
  return out;
}
