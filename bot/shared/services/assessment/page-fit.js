'use strict';
/**
 * Fit a paper to the pages a school allows (bd-nr8mrm, Notion FEAT-209, Ramisha Riaz).
 *
 * The teacher asks for 1–5 pages. We print the paper, count the real pages, and tighten it one step
 * at a time until it fits. Every step keeps every question and a readable type size. When even the
 * tightest step runs over, she gets that print and the number of pages it needs, never a paper with
 * questions quietly cut. Pure: the caller hands in `render(step) -> { buffer, pages }`.
 */

const MAX_PAGES = 5;

/** Loosest first. Each step keeps everything the one before it did. */
const FIT_STEPS = Object.freeze([
  Object.freeze({ compact: false, twoCol: false, trimLines: false }),
  Object.freeze({ compact: true, twoCol: false, trimLines: false }),
  Object.freeze({ compact: true, twoCol: true, trimLines: false }),
  Object.freeze({ compact: true, twoCol: true, trimLines: true }),
]);

/** A short answer is five lines or fewer; a long answer keeps all its room. */
const SHORT_ANSWER_MAX_LINES = 5;

/** The page target as a whole number 1–5, or null when she set none (or sent nonsense). */
function pageTarget(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !/^\s*\d+\s*$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGES) return null;
  return n;
}

/** A paper she already asked to Save paper never prints looser than that. */
function firstStep({ compact } = {}) {
  return compact === true ? 1 : 0;
}

/** One line fewer on a short answer, never fewer than one; a long answer is left alone. */
function trimmedLines(n) {
  if (n <= 1 || n > SHORT_ANSWER_MAX_LINES) return n;
  return n - 1;
}

/**
 * Walk the steps from `start` until one prints in `target` pages or fewer.
 * An unreadable count is never taken as a fit; `needs` is only a number we actually read.
 */
async function fitToPages({ target, start = 0, render }) {
  let last = null;
  for (let step = start; step < FIT_STEPS.length; step += 1) {
    const { buffer, pages } = await render(step);
    last = { step, buffer, pages: pages ?? null };
    if (Number.isInteger(pages) && pages <= target) return { ...last, fits: true, needs: null };
  }
  return { ...last, fits: false, needs: Number.isInteger(last.pages) ? last.pages : null };
}

module.exports = { FIT_STEPS, MAX_PAGES, pageTarget, firstStep, trimmedLines, fitToPages };
