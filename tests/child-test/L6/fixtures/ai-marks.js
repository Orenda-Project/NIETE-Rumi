/**
 * ai_marks fixtures in L5's shape (CONTRACT §5, scoring/assemble.js): one object per block, every
 * item has a row with a confidence. `confident*` clear every bar; `unsure*` sit below them.
 * Children are referred to by roll number only.
 */
const urduConfident = () => ({
  version: 'ai-marks-v1', block: 'urdu',
  story: {
    words_correct: 41, words_attempted: 45, seconds: 60, finished_early: false, confidence: 0.9,
    flagged: [
      { idx: 4, word: 'والد', verdict: 'wrong', confidence: 0.8 },
      { idx: 8, word: 'گیا', verdict: 'skipped', confidence: 0.75 },
      { idx: 10, word: 'کشتی', verdict: 'wrong', confidence: 0.3 },
    ],
  },
  fallback: null,
  questions: [
    { id: 'u3A-q1', verdict: 'correct', heard: 'والد کے ساتھ', confidence: 0.9 },
    { id: 'u3A-q2', verdict: 'wrong', heard: 'پتھر', confidence: 0.8 },
    { id: 'u3A-q3', verdict: 'none', heard: '', confidence: 0.4 },
  ],
  first_sounds: [
    { id: 'u3A-fs1', verdict: 'correct', heard: 'م', confidence: 0.4, hint_only: true },
    { id: 'u3A-fs2', verdict: 'wrong', heard: 'ج', confidence: 0.4, hint_only: true },
    { id: 'u3A-fs3', verdict: 'correct', heard: 'ب', confidence: 0.9, hint_only: true },
    { id: 'u3A-fs4', verdict: 'none', heard: '', confidence: 0, hint_only: true },
    { id: 'u3A-fs5', verdict: 'correct', heard: 'گ', confidence: 0.4, hint_only: true },
  ],
  nonwords: [
    { id: 'u3A-nw1', verdict: 'correct', heard: 'تامو', confidence: 0.9 },
    { id: 'u3A-nw2', verdict: 'wrong', heard: 'نوری', confidence: 0.8 },
    { id: 'u3A-nw3', verdict: 'correct', heard: 'سیکا', confidence: 0.7 },
    { id: 'u3A-nw4', verdict: 'wrong', heard: 'بولو', confidence: 0.5 },
    { id: 'u3A-nw5', verdict: 'correct', heard: 'داپو', confidence: 0.66 },
  ],
  maths: null,
  protocol_flags: [],
  model_versions: { counts: 'google/gemini-3.8-flash' },
});

const englishConfident = () => ({
  version: 'ai-marks-v1', block: 'english',
  story: { words_correct: 17, words_attempted: 21, seconds: 60, finished_early: false, confidence: 0.85,
    flagged: [{ idx: 3, word: 'class', verdict: 'wrong', confidence: 0.7 }, { idx: 7, word: 'plant', verdict: 'wrong', confidence: 0.9 }] },
  fallback: null,
  questions: [
    { id: 'e3A-q1', verdict: 'correct', heard: 'trees', confidence: 0.95 },
    { id: 'e3A-q2', verdict: 'wrong', heard: 'he woke up', confidence: 0.75 },
  ],
  first_sounds: [],
  nonwords: ['correct', 'wrong', 'correct', 'correct', 'wrong', 'correct', 'correct', 'none'].map((v, i) => ({
    id: `e3A-nw${i + 1}`, verdict: v, heard: '', confidence: i === 7 ? 0.2 : 0.8,
  })),
  maths: null,
  protocol_flags: [],
  model_versions: {},
});

const mathsConfident = () => ({
  version: 'ai-marks-v1', block: 'maths',
  story: null, fallback: null, questions: [], first_sounds: [], nonwords: [],
  maths: {
    numbers: ['correct', 'correct', 'wrong', 'correct', 'correct', 'wrong', 'correct', 'none'].map((v, i) => ({
      id: `m3A-n${i + 1}`, verdict: v, heard: '', confidence: i === 5 ? 0.5 : 0.9,
    })),
    quick_sums: { correct: 12, attempted: 14, seconds: 60, confidence: 0.8 },
    written: [
      { id: 'm3A-w1', read_answer: '62', verdict: 'correct', confidence: 0.9 },
      { id: 'm3A-w2', read_answer: '73', verdict: 'wrong', confidence: 0.85 },
      { id: 'm3A-w3', read_answer: '', verdict: 'unreadable', confidence: 0 },
      { id: 'm3A-w4', read_answer: '', verdict: 'blank', confidence: 0.8 },
    ],
    word_problem: { verdict: 'correct', read_answer: '9', confidence: 0.6 },
  },
  protocol_flags: [],
  model_versions: {},
});

const urduFallback = () => ({
  ...urduConfident(),
  story: null,
  fallback: { letters: { correct: 7, of: 10 }, words: { correct: 4, of: 10 }, confidence: 0.8 },
});

const urduUnsureStory = () => {
  const m = urduConfident();
  m.story.confidence = 0.5;
  return m;
};

module.exports = { urduConfident, englishConfident, mathsConfident, urduFallback, urduUnsureStory };
