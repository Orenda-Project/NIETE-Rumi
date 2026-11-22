/**
 * bd-snkn32.59.9 (queue #184) — the Urdu of "A whole unit", read on staging at phone size (22 Nov) and corrected where
 * it read as a word-for-word draft. These pin the reviewed lines so a later edit cannot quietly bring the draft back.
 */
import { describe, expect, it } from 'vitest';
import { UNIT_COPY as EN, UNIT_COPY_UR as UR } from './unitCopy';

describe('A whole unit: reviewed Urdu', () => {
  it('asks the period in minutes and says the choice is kept for the class', () => {
    expect(UR.periodQ).toBe('آپ کا پیریڈ کتنے منٹ کا ہے؟');
    expect(UR.periodSaved).toBe('یہ اس کلاس کے لیے یاد رکھا جائے گا۔ آپ اسے بعد میں بدل سکتے ہیں۔');
  });

  it('names the first and last chapter, not a dangling سے / تک', () => {
    expect(UR.from).toBe('پہلا');
    expect(UR.to).toBe('آخری');
  });

  it('writes a chapter range with تا, which an RTL page cannot reverse (a dash showed «2 – 1»)', () => {
    expect(UR.chapterRange(1, 2)).toBe('ابواب 1 تا 2');
    expect(UR.chapterRange(3, 3)).toBe('باب 3');
    expect(EN.chapterRange(1, 2)).toBe('Chap 1–2');
    expect(EN.chapterRange(3, 3)).toBe('Chap 3');
  });

  it('says what each pace does in whole sentences', () => {
    expect(UR.paceHints.slower).toBe('ہر موضوع کے بعد مشق کا ایک اضافی دن');
    expect(UR.paceHints.faster).toBe('مشق کے دن پچھلے دن کے ساتھ مل جاتے ہیں۔ دہرائی اور ٹیسٹ کے دن برقرار رہتے ہیں۔');
    expect(UR.goalPaceHints.slower).toBe('ہر مقصد کے بعد مشق کا ایک اضافی دن');
    expect(UR.goalPaceHints.faster).not.toMatch(/باقی/);
  });

  it('keeps the day buttons short and unambiguous', () => {
    expect(UR.openPlan).toBe('پلان کھولیں'); // the long button squeezed each day's title to two words a line
    expect(UR.undo).toBe('تبدیلی واپس لیں'); // «واپس» alone reads as «Back»
    expect(UR.yourDays).toBe('یونٹ کے دن');
    expect(UR.split).toBe('دو دنوں میں تقسیم کریں');
  });

  it('counts plans, not days, as made', () => {
    expect(UR.progress(3, 17)).toBe('17 میں سے 3 دنوں کے لیسن پلان بن گئے');
  });
});
