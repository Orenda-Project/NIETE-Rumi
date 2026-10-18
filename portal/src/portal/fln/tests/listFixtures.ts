/**
 * bd-t7zk3t.11 — synthetic catalogue answers for the list-side tests (band, chooser, list, gate).
 * SHAPE only, never corpus text (the repo is public): a guide at pos 0, a screener with its own note and
 * minutes, core rows with sound counts, an additional-practice row, an Urdu title with a Latin token and
 * mixed digits, a Numeracy extended strand.
 */
import { vi } from 'vitest';
import type { FlnCatalogue, FlnLevel, FlnMe, FlnRow } from '../types';

export const LEVELS: FlnLevel[] = [
  { level: 1, grades: [1], count: 66, screener_id: 9002, screener_minutes: 53, note_en: 'one child at a time · 2–4 sessions', note_ur: 'ایک وقت میں ایک بچہ' },
  { level: 2, grades: [2, 3], count: 72, screener_id: 9002, screener_minutes: 53, note_en: 'one child at a time · 2–4 sessions', note_ur: 'ایک وقت میں ایک بچہ' },
  { level: 3, grades: [4, 5], count: 70, screener_id: 9002, screener_minutes: 53, note_en: 'one child at a time · 2–4 sessions', note_ur: 'ایک وقت میں ایک بچہ' },
];

const row = (r: Partial<FlnRow> & { id: number; pos: number }): FlnRow => ({
  title: `Synthetic lesson ${r.id}`,
  lang: 'en',
  dir: 'ltr',
  minutes: 25,
  chips: {},
  opened: false,
  count: 66,
  label: null,
  ...r,
});

/** RH-EN grade 1: guide (pos 0), screener (pos 1), core 2–5, an additional row at 6. Opened through pos 3. */
export function rhEnG1(): FlnCatalogue {
  return {
    subject: { key: 'rh-en', lang: 'en', dir: 'ltr' },
    grade: 1,
    level: 1,
    levels: LEVELS,
    strands: [
      {
        strand: 'daily',
        chapters: [
          {
            chapter_no: 1,
            title_en: 'Start here',
            title_ur: 'یہاں سے شروع کریں',
            plans: [
              // deliberately out of pos order: the client sorts by pos
              row({ id: 9002, pos: 1, title: 'Synthetic screener', minutes: 53, chips: { screener: true, sounds: 54, narration: true }, label: 'screener', opened: true }),
              row({ id: 9001, pos: 0, title: 'Synthetic guide', minutes: 58, chips: { guide: true }, label: 'guide', opened: true }),
            ],
          },
          {
            chapter_no: 2,
            title_en: 'Letter sounds',
            title_ur: 'حروف کی آوازیں',
            plans: [
              row({ id: 9003, pos: 2, chips: { sounds: 2 }, opened: true }),
              row({ id: 9004, pos: 3, chips: { sounds: 1 }, opened: true }),
              row({ id: 9005, pos: 4, chips: { sounds: 5, textbook: true } }),
              row({ id: 9006, pos: 5, chips: { sounds: 2, video: true } }),
              row({ id: 9007, pos: 6, chips: { additional: true }, label: 'additional_practice' }),
            ],
          },
        ],
      },
    ],
  };
}

/** RH-UR grade 1 (Urdu plans; one title carries a Latin token and mixed digits). */
export function rhUrG1(): FlnCatalogue {
  return {
    subject: { key: 'rh-ur', lang: 'ur', dir: 'rtl' },
    grade: 1,
    level: 1,
    levels: LEVELS,
    strands: [
      {
        strand: 'daily',
        chapters: [
          {
            chapter_no: 1,
            title_en: 'Start here',
            title_ur: 'یہاں سے شروع کریں',
            plans: [
              row({ id: 9101, pos: 0, title: 'منصوبہ بندی کا تعارف', lang: 'ur', dir: 'rtl', chips: { guide: true }, label: 'guide', opened: true }),
              row({ id: 9102, pos: 1, title: 'آزمائشی اسکرینر', lang: 'ur', dir: 'rtl', minutes: 16, chips: { screener: true, sounds: 30 }, label: 'screener' }),
            ],
          },
          {
            chapter_no: 2,
            title_en: 'Letter sounds',
            title_ur: 'حروف کی آوازیں',
            plans: [
              row({ id: 9103, pos: 2, title: 'SLO کا تعارف 2 حروف', lang: 'ur', dir: 'rtl', minutes: 56, chips: { sounds: 6 } }),
              row({ id: 9104, pos: 3, title: 'Synthetic English title', minutes: 45, chips: { sounds: 1, additional: true }, label: 'additional_practice' }),
            ],
          },
        ],
      },
    ],
  };
}

/** NUM grade 2: a daily strand and a 20-lesson extended strand. */
export function numG2(): FlnCatalogue {
  return {
    subject: { key: 'num', lang: 'en', dir: 'ltr' },
    grade: 2,
    level: 2,
    levels: LEVELS.map((l) => ({ ...l, screener_id: 9200 + l.level, screener_minutes: 20 + l.level })),
    strands: [
      {
        strand: 'daily',
        chapters: [{ chapter_no: 1, title_en: 'Numbers', title_ur: 'اعداد', plans: [
          row({ id: 9301, pos: 1, title: 'Daily one', count: 40 }),
          row({ id: 9302, pos: 2, title: 'Daily two', count: 40 }),
        ] }],
      },
      {
        strand: 'extended',
        chapters: [{ chapter_no: 1, title_en: 'Extended', title_ur: 'توسیعی', plans: [
          row({ id: 9401, pos: 1, title: 'Extended one', count: 20 }),
        ] }],
      },
    ],
  };
}

/** Grade 8 without a level: the chooser's answer. */
export function rhEnG8(): FlnCatalogue {
  return { subject: { key: 'rh-en', lang: 'en', dir: 'ltr' }, grade: 8, level: null, levels: LEVELS, strands: [] };
}

export const ME_TEACHER: FlnMe = { lessons: true, share: false, role: 'teacher', ui_lang: 'en' };

type Answer = { status: number; body?: unknown } | ((url: URL) => { status: number; body?: unknown });

/**
 * Stub `fetch` (the network boundary). `routes` maps a path prefix under /api/portal/fln to an answer; anything
 * else is a 404. Returns the mock so tests can count calls.
 */
export function stubFetch(routes: Record<string, Answer>) {
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/portal\/fln/, '');
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path === k || path.startsWith(k));
    const a = key ? routes[key] : { status: 404, body: { error: 'not_found' } };
    const { status, body } = typeof a === 'function' ? a(url) : a;
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
