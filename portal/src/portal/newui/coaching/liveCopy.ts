import { bilingual } from '../../teacher/i18n';

/**
 * bd-v0toag.31 — the live-moves words a group D teacher reads while she records, in English and Urdu.
 * Kept out of COACHING_COPY (English only, labels only): these are hers, in her language.
 * The Urdu is a draft for Amena's check.
 */
export const LIVE_COPY = bilingual(
  {
    pickTitle: 'Which lesson are you teaching?',
    skip: 'Skip',
    caveat: "Ticks are the app's best guess from the recording and can be wrong in a busy class. Tap any move to agree or disagree.",
    paused: 'Live ticks paused. Your recording is safe.',
    yesDid: 'Yes, I did this',
    noDidnt: "No, I didn't",
    iDid: 'I did this',
    sheetTitle: 'This move',
    minutes: (n: number) => `${n} min`,
    sections: { open: 'Open', explain: 'Explain', we: 'We Do', you: 'You Do', check: 'Check' },
  },
  {
    pickTitle: 'آپ کون سا سبق پڑھا رہی ہیں؟',
    skip: 'چھوڑیں',
    caveat: 'ٹِک ریکارڈنگ سے ایپ کا اندازہ ہیں اور شور والی کلاس میں غلط ہو سکتے ہیں۔ کسی بھی قدم پر ٹیپ کر کے ہاں یا نہ کہیں۔',
    paused: 'لائیو ٹِک رُکے ہوئے ہیں۔ آپ کی ریکارڈنگ محفوظ ہے۔',
    yesDid: 'ہاں، میں نے یہ کیا',
    noDidnt: 'نہیں، میں نے نہیں کیا',
    iDid: 'میں نے یہ کیا',
    sheetTitle: 'یہ قدم',
    minutes: (n: number) => `${n} منٹ`,
    sections: { open: 'آغاز', explain: 'وضاحت', we: 'مل کر کریں', you: 'خود کریں', check: 'جانچ' },
  },
);
