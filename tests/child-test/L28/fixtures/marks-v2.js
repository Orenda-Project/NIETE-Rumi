/**
 * ai-marks-v2 (CONTRACT §19 "L27 scoring → L28") for Grade 3 Set A: story + 3 questions (+ fallback) per
 * language, and maths.oral = 4 compare, 4 sums, 2 word problems. Synthetic; no child data.
 */
const URDU_Q2_PROMPT = 'بلال نے کس چیز کو حرکت کرتے دیکھا؟';

function verdicts(right, n = 3) {
  return Array.from({ length: n }, (_, i) => (i === 0 && right >= 1) || (i === 2 && right >= 2) || (i === 1 && right >= 3) ? 'correct' : 'wrong');
}

function reading(block, prefix, { wc, right, seconds = 60, qConf = [0.95, 0.95, 0.95], storyConf = 0.9, fallback = null, heard = [] }) {
  const v = verdicts(right);
  return {
    version: 'ai-marks-v2',
    block,
    story: { words_correct: wc, words_attempted: wc + 4, seconds, finished_early: seconds < 60, flagged: [], confidence: storyConf },
    fallback,
    questions: v.map((verdict, i) => ({ id: `${prefix}-q${i + 1}`, verdict, heard: heard[i] || `answer ${i + 1}`, confidence: qConf[i] })),
    protocol_flags: [],
    model_versions: { stt: 'soniox:test', counts: 'google/gemini-3.8-flash', comprehension: 'google/gemini-3-flash-preview' },
  };
}

const urdu = (o = {}) => reading('urdu', 'u3A', { wc: 41, right: 2, heard: ['اپنے ابو کے ساتھ', 'وہ دریا پر گیا', 'مچھلی دیکھ کر'], ...o });
const english = (o = {}) => reading('english', 'e3A', { wc: 18, right: 1, ...o });

/** right: how many of the 10 are correct (in order); lowConf: [kind, index] made doubtful (and wrong). */
function maths({ right = 7, lowConf = null } = {}) {
  let n = 0;
  const item = (id) => { n += 1; return { id, verdict: n <= right ? 'correct' : 'wrong', heard: `heard ${id}`, confidence: 0.95 }; };
  const oral = {
    compare: [1, 2, 3, 4].map((i) => item(`m3A-c${i}`)),
    sums: [1, 2, 3, 4].map((i) => item(`m3A-s${i}`)),
    word_problems: [1, 2].map((i) => item(`m3A-wp${i}`)),
  };
  if (lowConf) Object.assign(oral[lowConf[0]][lowConf[1]], { verdict: 'wrong', confidence: 0.3 });
  return { version: 'ai-marks-v2', block: 'maths', maths: { oral }, protocol_flags: [], model_versions: { stt: 'soniox:test' } };
}

module.exports = { urdu, english, maths, URDU_Q2_PROMPT };
