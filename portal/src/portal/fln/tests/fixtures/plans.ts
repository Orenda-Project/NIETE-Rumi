/**
 * bd-t7zk3t.11 — SYNTHETIC plan fixtures for the plan-page tests. Same SHAPE as the normalised corpus plans
 * (a Reading Hour English phonics plan, a Reading Hour Urdu plan, a Numeracy plan, a screener) and the same hazards
 * (Latin tokens inside Urdu headers, mixed ASCII/Urdu digits, `**bold**`, repeated clips, images with true sizes).
 * No text here comes from the corpus; every URL is a placeholder host.
 */
import type { FlnMedia, FlnPlanResponse } from '../../types';

const A = 'https://media.example.org/fln/audio';
const I = 'https://media.example.org/fln/image';

const snd = (sha8: string, name: string, extra: Partial<FlnMedia> = {}): FlnMedia => ({
  kind: 'audio', src: `${A}/${sha8}/${name}.mp3`, orig: `https://orig.example.org/${name}.mp3`, sha8, role: 'sound', duration_s: 12, ...extra,
});
const img = (name: string, w = 960, h = 720): FlnMedia => ({
  kind: 'image', src: `${I}/${name}.webp`, orig: `https://orig.example.org/${name}.png`, w, h, full: `https://orig.example.org/${name}.png`,
});

export const rhEn: FlnPlanResponse = {
  plan: {
    id: 90001, key: 'fln:90001', subject: 'rh-en', lang: 'en', dir: 'ltr', programme: 'p25',
    title: "Sounds of 'p, t' (Fluency)",
    slo: ['Students will be able to say the sounds of p and t in words.', 'Students will read short words with p and t.'],
    resources: ['Board', 'Marker'],
    minutes: { total: 30, opening: 5, explain: 15, practice: 10 },
    setup: [{ kind: 'instruction', text: 'Draw the word wall before class.', media: [img('wall')] }],
    sections: [
      { kind: 'opening', minutes: 5, groups: [
        { header: 'Word of the Day', level: null, items: [
          { kind: 'instruction', text: 'Write the word **pen** in the corner of the board.', media: [] },
          { kind: 'say', text: 'Today we will learn two sounds.', media: [] },
        ] },
      ] },
      { kind: 'explain', minutes: 15, groups: [
        { header: 'Sound of the Day', level: null, items: [
          { kind: 'instruction', text: "Say the sound **'p'** as in pan.", media: [snd('aa000001', 'p', { label_en: 'p', caption_en: 'as in Pan' })] },
          { kind: 'instruction', text: 'Say the sound **t** with the children.', media: [snd('aa000002', 't')] },
          { kind: 'ask', text: 'What sound does *pan* start with?', media: [] },
          { kind: 'answer', text: 'It starts with p.', media: [] },
          { kind: 'instruction', text: 'Play both sounds again.\n1. First p\n2. Then t', media: [
            snd('aa000001', 'p', { label_en: 'p', caption_en: 'as in Pan' }), snd('aa000002', 't'),
          ] },
        ] },
      ] },
      { kind: 'practice', minutes: 10, groups: [
        { header: null, level: null, items: [
          { kind: 'instruction', text: 'Listen to the story.', media: [snd('aa000003', 'story', { role: 'narration', label_en: 'Listen to the story' })] },
          { kind: 'instruction', text: 'Show the picture.', media: [img('board', 800, 600)] },
        ] },
      ] },
    ],
    homework: [{ kind: 'instruction', text: 'Find three things that start with p.', media: [] }],
    summary: [],
    audio_summary: { sounds: 2, words: 0, narration: true },
  },
  placement: [{ subject: 'rh-en', level: 1, grades: [1], strand: 'daily', pos: 24, count: 48, label: null }],
};

export const rhUr: FlnPlanResponse = {
  plan: {
    id: 90002, key: 'fln:90002', subject: 'rh-ur', lang: 'ur', dir: 'rtl', programme: 'p25',
    title: 'حروف ب اور پ کی آوازیں (روانی)',
    slo: ['طلباء حروف ب اور پ کی آوازیں 2 طریقوں سے پہچان سکیں گے۔'],
    resources: ['بورڈ', 'مارکر'],
    minutes: { total: 40, opening: 5, explain: 20, practice: 12, conclusion: 3 },
    setup: [{ kind: 'instruction', text: 'کلاس سے پہلے بورڈ پر Word Wall بنائیں۔', media: [img('ur-wall')] }],
    sections: [
      { kind: 'opening', minutes: 5, groups: [
        { header: 'کا تعارف SLO', level: null, items: [
          { kind: 'instruction', text: 'استاد بورڈ پر سبق 3 اور سبق ۴ لکھیں۔', media: [] },
        ] },
      ] },
      { kind: 'explain', minutes: 20, groups: [
        { header: 'حروف کا تلفظ', level: 'beginner', items: [
          { kind: 'say', text: 'یہ حرف **ب** ہے۔', media: [snd('bb000001', 'ba', { label_ur: 'ب', label_en: 'Bay' })] },
          { kind: 'instruction', text: 'حرف **پ** کی آواز سنائیں (Pay)۔', media: [snd('bb000002', 'pa', { label: 'Pay' })] },
          { kind: 'ask', text: 'یہ کون سا حرف ہے؟', media: [] },
        ] },
      ] },
      { kind: 'practice', minutes: 12, groups: [
        { header: null, level: null, items: [
          { kind: 'instruction', text: 'ورک شیٹ 1 کھولیں۔', media: [{ kind: 'pdf', src: 'https://media.example.org/fln/pdf/sheet.pdf' }] },
        ] },
      ] },
      { kind: 'conclusion', minutes: 3, groups: [
        { header: null, level: null, items: [{ kind: 'instruction', text: 'آج کے الفاظ دہرائیں۔', media: [] }] },
      ] },
    ],
    homework: [{ kind: 'instruction', text: 'گھر پر 5 الفاظ لکھیں۔', media: [] }],
    summary: [],
    audio_summary: { sounds: 2, words: 0, narration: false },
  },
  placement: [{ subject: 'rh-ur', level: 1, grades: [1], strand: 'daily', pos: 27, count: 58, label: null }],
};

export const numEn: FlnPlanResponse = {
  plan: {
    id: 90003, key: 'fln:90003', subject: 'num', lang: 'en', dir: 'ltr', programme: 'p25',
    title: 'Add two-digit numbers',
    slo: ['Students will add two-digit numbers.'],
    resources: ['Counters'],
    minutes: { total: 45, opening: 10, explain: 20, practice: 15 },
    sections: [
      { kind: 'opening', minutes: 10, groups: [{ header: 'Numbers Drill', level: null, items: [{ kind: 'instruction', text: 'Count to 50 together.', media: [] }] }] },
      { kind: 'explain', minutes: 20, groups: [{ header: 'Concrete', level: null, items: [{ kind: 'instruction', text: 'Show 23 + 14 with counters.', media: [img('counters')] }] }] },
      { kind: 'practice', minutes: 15, groups: [
        { header: 'Practice', level: 'beginner', items: [{ kind: 'instruction', text: 'Solve 12 + 11.', media: [] }] },
        { header: 'Practice', level: 'intermediate', items: [{ kind: 'instruction', text: 'Solve 35 + 27.', media: [] }] },
      ] },
    ],
    homework: [],
    summary: [],
  },
  placement: [{ subject: 'num', level: 2, grades: [2, 3], strand: 'daily', pos: 7, count: 30, label: null }],
};

export const screenerEn: FlnPlanResponse = {
  plan: {
    id: 90004, key: 'fln:90004', subject: 'rh-en', lang: 'en', dir: 'ltr', programme: 'p25',
    title: 'Reading Screener',
    slo: ['Place each student in a reading group.'],
    resources: ['Scoring sheet'],
    minutes: { total: 50, opening: 5, explain: 40, conclusion: 5 },
    sections: [
      { kind: 'opening', minutes: 5, groups: [{ header: null, level: null, items: [{ kind: 'instruction', text: 'Call one child at a time.', media: [] }] }] },
      { kind: 'explain', minutes: 40, groups: [{ header: 'Letter sounds', level: null, items: [
        { kind: 'instruction', text: 'Ask the child to say **m**.', media: [snd('cc000001', 'm', { label_en: 'm' })] },
      ] }] },
      { kind: 'conclusion', minutes: 5, groups: [{ header: null, level: null, items: [{ kind: 'instruction', text: 'Record the group.', media: [] }] }] },
    ],
    homework: [],
    summary: [],
    audio_summary: { sounds: 1, words: 0, narration: false },
  },
  placement: [{ subject: 'rh-en', level: 1, grades: [1], strand: 'daily', pos: 2, count: 48, label: 'screener' }],
};
