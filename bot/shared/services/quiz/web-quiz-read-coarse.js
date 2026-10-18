'use strict';
/**
 * A reading's words attempted, as a coarse count for a phone that may not name the run's child. A one-minute
 * reading that ran to the timer has its words attempted as a words-a-minute figure, so another phone gets only:
 *   all of the story's words (attempted >= len) -> len; at least a tenth (rounded up) -> that tenth; some -> 1; none -> 0.
 * len: the story's words as the reading page counts them (its story.tokens). Every decision the page takes from the
 * count stays the same: none / some (=== 0, > 0), the try card under a tenth (wq-finish-card.js unheard) and read all /
 * read some (wq-trail.js readEnd `>= storyLen`). An unknown length (0) gives only none / some (0 / 1).
 */
function coarseAttempted(attempted, len) {
  const n = Number(attempted);
  if (!(n > 0)) return 0;
  const L = Number(len) > 0 ? Math.floor(Number(len)) : 0;
  if (!L) return 1;
  if (n >= L) return L;
  const tenth = Math.ceil(0.1 * L);
  return n >= tenth ? tenth : 1;
}

module.exports = { coarseAttempted };
