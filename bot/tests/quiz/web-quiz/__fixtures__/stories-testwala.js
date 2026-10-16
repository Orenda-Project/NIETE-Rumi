'use strict';
/**
 * Invented storybooks for the Stories tests: "Testwala" books with two made-up pages each. No real book, page,
 * picture, story text or audio is ever in the repo (the real ones live in the database and the storage bucket).
 */
const BOOK = (n) => `5b${String(n).padStart(6, '0')}-0000-4000-8000-000000000000`;
const PAGE = (b, n) => `5c${String(b).padStart(3, '0')}${String(n).padStart(3, '0')}-0000-4000-8000-000000000000`;

function book(n, extra = {}) {
  return {
    id: BOOK(n), source_id: `testwala-${n}`, slug: `g2-en-testwala-${n}`, title: `Book ${n} Testwala`, grade: 2, lang: 'en',
    author: 'Writer Testwala', illustrator: 'Artist Testwala', pages: 2, cover_file: `cover-aaaa000${n}.webp`, cover_w: 160, cover_h: 240,
    minutes: 1.5, status: 'ready', featured_rank: null, ...extra,
  };
}

// Book 1: the two-page English book the reader tests open.
const P1 = {
  id: PAGE(1, 1), book_id: BOOK(1), n: 1, image_file: 'p01-bbbb0001.webp', image_w: 720, image_h: 1080,
  text: 'Sami Testwala sees a kite.', boxes_ok: true, text_source: 'pdf', confidence: 0.99, is_picture: false,
  words: [
    { i: 0, t: 'Sami', box: [100, 880, 60, 40] }, { i: 1, t: 'Testwala', box: [170, 880, 120, 40] }, { i: 2, t: 'sees', box: [300, 880, 60, 40] },
    { i: 3, t: 'a', box: [370, 880, 20, 40] }, { i: 4, t: 'kite.', box: [400, 880, 70, 40] },
  ],
  text_band: { file: 'p01-band-cccc0001.webp', w: 1440, h: 200, box: [0, 860, 720, 100] },
};
const P2 = {
  id: PAGE(1, 2), book_id: BOOK(1), n: 2, image_file: 'p02-bbbb0002.webp', image_w: 720, image_h: 1080,
  text: 'The kite flies high.', boxes_ok: false, text_source: 'read', confidence: 0.9, is_picture: false,
  words: [{ i: 0, t: 'The' }, { i: 1, t: 'kite', box: [200, 900, 60, 40] }, { i: 2, t: 'flies' }, { i: 3, t: 'high.' }],
  text_band: null,
};
const P3 = {
  id: PAGE(1, 3), book_id: BOOK(1), n: 3, image_file: 'p03-bbbb0003.webp', image_w: 720, image_h: 1080,
  text: '', boxes_ok: false, text_source: 'pdf', confidence: 1, is_picture: true, words: [], text_band: null,
};

const VOICE_P1 = {
  id: 'v-p1', page_id: P1.id, lang: 'en', provider: 'soniox', voice: 'Grace', model: 'tts-rt-v2', is_current: true,
  audio_key: `readalong/sandbox/story/en/${BOOK(1)}-p01/grace-dddd0001.ogg`, ms: 3200, wpm: 94,
  timings: [{ i: 0, s_ms: 120, e_ms: 480 }, { i: 1, s_ms: 520, e_ms: 1100 }, { i: 2, s_ms: 1150, e_ms: 1500 }, { i: 3, s_ms: 1550, e_ms: 1650 }, { i: 4, s_ms: 1700, e_ms: 2300 }],
  timing_source: 'stt_align',
};
// An older voice of page 1 that is no longer current: never served.
const VOICE_P1_OLD = { ...VOICE_P1, id: 'v-p1-old', is_current: false, audio_key: 'readalong/sandbox/story/en/old.ogg', timings: [] };

const QUESTIONS = [
  { id: 'q1', book_id: BOOK(1), n: 1, kind: 'literal', q: 'What does Sami Testwala see?', options: ['A kite', 'A cat', 'A bus'], answer_i: 0, page_ref: 1, review_status: 'reviewed' },
  { id: 'q2', book_id: BOOK(1), n: 2, kind: 'inference', q: 'Where does the kite go?', options: ['Down', { t: 'Up high', img: 'q2o1-eeee0001.webp' }, 'Home'], answer_i: 1, page_ref: 2, review_status: 'reviewed' },
  { id: 'q3', book_id: BOOK(1), n: 3, kind: 'vocab', q: 'A draft question nobody reviewed', options: ['x', 'y', 'z'], answer_i: 2, page_ref: null, review_status: 'draft' },
];

module.exports = { BOOK, PAGE, book, P1, P2, P3, VOICE_P1, VOICE_P1_OLD, QUESTIONS };
