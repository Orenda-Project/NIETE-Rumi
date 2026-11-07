'use strict';
/**
 * The marking scheme a model writes, made safe to print.
 *
 * The generator asks for a scheme on every written item: points that add to the
 * item's marks, accepted alternatives, the common error. Models get the sums
 * wrong, invent kinds, put a paragraph in a chip and attach schemes to MCQs.
 * `normaliseScheme` checks each question against the pattern slot it was set
 * for and keeps only what a teacher can mark with: a split that does not add up
 * is dropped (the answer still prints), every cap counts code points, and the
 * words a comprehension asks the child to pick must really be in its passage.
 *
 * A written row left with no points would print only what it is worth (a bare
 * «2.5» chip, nothing to mark against): it gets one Accuracy point worth the
 * row's marks, carrying its answer, and is listed in `_layout.scheme_shortfall`
 * so the before-the-exam box can say how many rows code filled.
 *
 * Pure: deep-clones its input, never throws. A question it cannot make sense of
 * loses its scheme and leaves a log line; the paper itself never fails here,
 * except through `shortfall` (too few pick words, a part with no answer), which
 * the engine acts on.
 */

const { canonicalBlooms, capCodePoints } = require('./marking-scheme/basics');
const { normaliseScheme } = require('./marking-scheme/normalise-scheme');

module.exports = { normaliseScheme, canonicalBlooms, capCodePoints };
