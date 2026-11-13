/**
 * bd-pw1ccr.38 — a G1-5 topic paper, checked once after writing (topic-checks.js). A skipped skill or a
 * copied worked example asks for the paper once more; the paper with fewer problems is kept, the first on
 * a tie or when the second ask fails.
 */
const { logToFile } = require('../../../utils/logger');
const { reviewTopicPaper, retryArgs } = require('./topic-checks');

async function writeTopicExam(args, generateExam) {
  const first = await generateExam(args);
  if (!Array.isArray(args.slos) || !args.slos.length) return first;
  const review = reviewTopicPaper(first.examJson, args);
  if (review.clean) return first;
  logToFile('[assessment] topic paper re-asked', {
    grade: args.grade, subject: args.subject, uncovered: review.uncovered, copied: review.copied.length,
  });
  try {
    const second = await generateExam(retryArgs(args, review));
    const again = reviewTopicPaper(second.examJson, args);
    logToFile('[assessment] topic paper re-ask result', { before: review.score, after: again.score });
    return again.score < review.score ? second : first;
  } catch (err) {
    logToFile('[assessment] topic paper re-ask failed', { error: err.message });
    return first;
  }
}

module.exports = { writeTopicExam };
