/**
 * bd-tbprit.10 — the words of Rifat's "3. Is this a pattern?". Her prototype's sentences, Urdu included; the rest
 * (recording less, plan not checked, not enough scores, no missed step, a counted tap, the month names' English)
 * is MACHINE-DRAFTED Urdu and awaits a native check. Months are a table so the English reads "Sep", as Rifat's
 * does, not the "Sept" en-GB gives.
 */

import { bilingual } from "../../teacher/i18n";

const EN = {
  title: "3. Is this a pattern?",
  lastN: (n: number) => `last ${n} lessons`,
  herAverage: (pct: number) => `her average ${pct}%`,
  nowLabel: (pct: number) => `${pct} now`,
  noLine: "Not enough AI scores for a line yet",
  months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],

  avgQ: "Average score · best",
  lowest: (now: number, n: number, best: string) => `This lesson (${now}%) is her lowest in ${n} lessons. Best was ${best}.`,
  below: (now: number, best: string) => `This lesson (${now}%) is just below her average. Best was ${best}.`,
  atOrAbove: (now: number, best: string) => `This lesson (${now}%) is at or above her average. Best was ${best}.`,

  rateQ: "Recordings per week",
  level: { active: "active", steady: "steady", atRisk: "recording less" },
  activeNote: (ict: string) => `ICT average is ${ict}. Low risk of her dropping off.`,
  spanNote: (n: number, from: string, to: string, ict: string) => `${n} lessons from ${from} to ${to}. ICT average is ${ict}.`,
  oneLesson: "Only one lesson so far.",

  missedQ: (step: string) => `${step} missed in last 5 lessons`,
  missedNoneQ: (of: number) => `Steps missed in last ${of} lessons`,
  nOf: (n: number, of: number) => `${n} of ${of}`,
  repeated: "Repeated gap, not a one-off.",
  once: "Missed here only.",
  notChecked: "Plan not checked",
  notCheckedNote: "This lesson's plan was not checked, so no step can be named.",
  none: "None",

  tapsQ: "Earlier “don’t agree” taps",
  firstTime: "First time she has disagreed, so take it seriously.",
  tapsNote: "She has disagreed before. Look at what she said then.",
};

export const PATTERN = bilingual(EN, {
  title: "3. کیا یہ بار بار ہو رہا ہے؟",
  lastN: (n: number) => `پچھلے ${n} اسباق`,
  herAverage: (pct: number) => `ان کی اوسط ${pct}%`,
  nowLabel: (pct: number) => `${pct} اب`,
  noLine: "لائن کے لیے ابھی کافی AI اسکور نہیں",
  months: ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"],

  avgQ: "اوسط اسکور · سب سے اچھا",
  lowest: (now: number, n: number, best: string) => `یہ سبق (${now}%) پچھلے ${n} اسباق میں سب سے کم ہے۔ سب سے اچھا ${best} کو۔`,
  below: (now: number, best: string) => `یہ سبق (${now}%) ان کی اوسط سے تھوڑا کم ہے۔ سب سے اچھا ${best} کو۔`,
  atOrAbove: (now: number, best: string) => `یہ سبق (${now}%) ان کی اوسط کے برابر یا زیادہ ہے۔ سب سے اچھا ${best} کو۔`,

  rateQ: "ہفتے میں ریکارڈنگز",
  level: { active: "فعال", steady: "برقرار", atRisk: "ریکارڈنگ کم" },
  activeNote: (ict: string) => `ICT کی اوسط ${ict} ہے۔ ان کے چھوڑنے کا خطرہ کم ہے۔`,
  spanNote: (n: number, from: string, to: string, ict: string) => `${from} سے ${to} تک ${n} اسباق۔ ICT کی اوسط ${ict} ہے۔`,
  oneLesson: "ابھی تک صرف ایک سبق۔",

  missedQ: (step: string) => `پچھلے 5 اسباق میں ${step} رہ گیا`,
  missedNoneQ: (of: number) => `پچھلے ${of} اسباق میں رہ جانے والے مراحل`,
  nOf: (n: number, of: number) => `${of} میں سے ${n}`,
  repeated: "بار بار کی کمی ہے، ایک بار کی نہیں۔",
  once: "صرف اس سبق میں رہ گیا۔",
  notChecked: "منصوبہ چیک نہیں ہوا",
  notCheckedNote: "اس سبق کا منصوبہ چیک نہیں ہوا، اس لیے کوئی مرحلہ نہیں بتایا جا سکتا۔",
  none: "کوئی نہیں",

  tapsQ: "پہلے «متفق نہیں» کتنی بار",
  firstTime: "یہ پہلی بار ہے، اس لیے سنجیدگی سے لیں۔",
  tapsNote: "یہ پہلے بھی متفق نہیں تھیں۔ دیکھیں تب انہوں نے کیا کہا تھا۔",
});
