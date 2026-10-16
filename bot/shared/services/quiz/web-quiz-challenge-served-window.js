'use strict';
/**
 * How long a served Challenge run row stays open: the stuck-run sweeper closes a served row older than this
 * (served → abandoned), and the serve re-serves the child's own served record row younger than this. One constant,
 * read by both, in a module of its own so neither has to require the other.
 */
const SERVED_MS = 24 * 60 * 60 * 1000;

module.exports = { SERVED_MS };
