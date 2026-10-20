/**
 * bd-tbprit.11 — the words of Rifat's "💡 Coaching suggestion". Her prototype's sentences, Urdu included, for the
 * disclaimer, the four step labels and hints, the ways, the call/visit labels, the flag and Undo. Her per-teacher
 * examples (Sadia's pairs, Annie's story) are made general here: the step comes from the card, else "this part".
 * MACHINE-DRAFTED Urdu awaiting a native check: the general templates, the "why" lines beyond hers, the warning
 * reasons, the sent / added / no-number / save-failed notes and the "nothing to listen to" line.
 */

import { bilingual } from "../../teacher/i18n";

const EN = {
  box: "💡 Coaching suggestion",
  disc: "This is only a suggestion. You are the coach: you decide how and in which way to coach her.",
  s1: "Listen to the audio", s2: "What did you find?", s3: "Suggested way to coach", s4: "What to do",
  s1h: "Tap ▶ and listen to this part first.",
  s2h: "After listening, tap the one answer that matches what you heard.",
  s3h: "★ marks our suggestion. You can tap another way if you prefer.",
  listenFor: (what: string) => `Listen for: ${what}`,
  noPart: "There is no single part to point to. Listen to the whole lesson.",
  pick: "Choose what you found to see the suggested way.",

  found: {
    right: { label: "The teacher was right", sub: "She did it. The report missed it." },
    help: { label: "She needs help with the move", sub: "She wasn’t sure how to do it in her class." },
    fit: { label: "The move doesn’t fit her class", sub: "Too many children or too little time." },
    notRec: {
      label: "Not in the recording",
      sub: (min: number) => `What she described is not in the recording. The recording is ${min} minutes long.`,
      subNoLen: "What she described is not in the recording.",
    },
  },

  modes: { msg: "Message", call: "Call", visit: "Visit" },
  when: { msg: "today", call: "in 1–2 days", visit: "next visit" },
  rec: "suggested",
  why: {
    right: "She was right. A short message is enough: thank her and flag the report.",
    help: "No warning signs. A short call is enough to practise the move together.",
    helpUp: (reason: string) => `Usually a call, but ${reason}. So see it in her class.`,
    fit: "The problem is her classroom: size, seating or time. See the class to find a version that works.",
    notRec: "What she described is not in the recording, so the report can’t show it. Call her: trust her account, ask what she did, and agree to record the whole lesson next time.",
  },
  reasons: {
    missed: (step: string, n: number, of: number) => `${step} was missed in ${n} of her last ${of} lessons. It has become a habit`,
    repeat: (nth: number) => `this is disagreement number ${nth} from her`,
    recordingLess: "she is recording less",
  },

  qs: "Ask her", stuck: "If she gets stuck", agree: "Agree for tomorrow", check: "Next recording",
  rightCall: "Thank her, and tell her the report is being checked again.",
  msgL: "Ready message (you can edit it)",
  send: "Send to ", send0s: " on WhatsApp",
  sent: "WhatsApp opened. When you have talked, mark this card as done.",
  noPhone: "No WhatsApp number on file for her. Copy the message and send it yourself.",
  autoFlag: "✓ Report sent to the DC team for review. Nothing else to do for this.",
  undo: "Undo", unflagged: "Report not flagged.", reflag: "Flag it again",
  addVisit: "Add to my next visit", added: "Added to your next visit.",
  noVisit: "No visit is needed for this. A message is enough.",
  saveFailed: "Couldn’t save. Check your connection and try again.",
  thisPart: "this part",

  tpl: {
    help: {
      qs: (s: string) => [`What did you want to happen in ${s}?`, "What did you hear in the recording?", "What one thing will you change tomorrow?"],
      stuck: (s: string) => [`Do the move once yourself in ${s}, then she does it with you.`, "She says the line twice with you, using a word from her lesson."],
      visit: (s: string) => [`Sit in during ${s}.`, "Model the move with one row, then she leads the next row.", "Afterwards, agree the move for tomorrow."],
      agree: (s: string) => `Try the move once in ${s} tomorrow.`,
      check: (s: string) => `Did she do the move in ${s}?`,
    },
    fit: {
      qs: (s: string) => [`What did you want to happen in ${s}?`, "What gets in the way in your class?", "What smaller version could work tomorrow?"],
      stuck: (_s: string) => ["Ask what gets in the way: class size, seating or time.", "Agree a smaller version: the first two rows only, or fewer times in the lesson."],
      visit: (s: string) => [`Watch how the class is seated during ${s}.`, "Try the move with the first two rows only.", "Agree that version for tomorrow."],
      agree: (_s: string) => "The smaller version, in the first two rows only.",
      check: (_s: string) => "Did she try the smaller version?",
    },
    notRec: {
      qs: (s: string) => [`What did you do in ${s} after the recording stopped?`, "How did the children take part?", `Can you record the whole lesson next time, or at least ${s}?`],
      stuck: (s: string) => [`If she can’t record the whole lesson, agree to start the recording just before ${s}.`, "Check her phone storage and battery together."],
      visit: (_s: string) => ["Watch how she records: where the phone is, storage and battery.", "Start the recording together before the lesson.", "Agree to record the whole lesson."],
      agree: (s: string) => `Record the whole lesson next time, or at least ${s} from start to end.`,
      check: (s: string) => `Is the recording longer than 30 minutes, and does it include ${s}?`,
    },
  },
};

export const COACHING = bilingual(EN, {
  box: "💡 کوچنگ کا مشورہ",
  disc: "یہ صرف مشورہ ہے۔ آپ کوچ ہیں؛ کوچنگ کیسے اور کس طریقے سے ہو، اس کا فیصلہ آپ کریں گے۔",
  s1: "آڈیو سنیں", s2: "آپ نے کیا پایا؟", s3: "کوچنگ کا تجویز کردہ طریقہ", s4: "کیا کریں",
  s1h: "پہلے ▶ دبا کر یہ حصہ سنیں۔",
  s2h: "سننے کے بعد، جو آپ نے سنا اس سے ملتا ایک جواب ٹیپ کریں۔",
  s3h: "★ ہمارا مشورہ ہے۔ آپ چاہیں تو دوسرا طریقہ ٹیپ کر سکتے ہیں۔",
  listenFor: (what: string) => `یہ سنیں: ${what}`,
  noPart: "کوئی ایک حصہ نہیں جس کی طرف اشارہ ہو۔ پورا سبق سنیں۔",
  pick: "تجویز کردہ طریقہ دیکھنے کے لیے چنیں کہ آپ نے کیا پایا۔",

  found: {
    right: { label: "ٹیچر درست تھیں", sub: "انہوں نے یہ کیا تھا۔ رپورٹ سے رہ گیا۔" },
    help: { label: "انہیں موو میں مدد چاہیے", sub: "انہیں واضح نہیں تھا کہ اپنی کلاس میں یہ کیسے کریں۔" },
    fit: { label: "موو ان کی کلاس میں نہیں چلتا", sub: "بچے بہت زیادہ یا وقت بہت کم ہے۔" },
    notRec: {
      label: "ریکارڈنگ میں نہیں ملا",
      sub: (min: number) => `ٹیچر نے جو بتایا وہ ریکارڈنگ میں نہیں ملا۔ ریکارڈنگ ${min} منٹ کی ہے۔`,
      subNoLen: "ٹیچر نے جو بتایا وہ ریکارڈنگ میں نہیں ملا۔",
    },
  },

  modes: { msg: "پیغام", call: "کال", visit: "دورہ" },
  when: { msg: "آج", call: "1–2 دن میں", visit: "اگلا دورہ" },
  rec: "تجویز",
  why: {
    right: "وہ درست تھیں۔ مختصر پیغام کافی ہے: شکریہ ادا کریں اور رپورٹ نشان زد کریں۔",
    help: "کوئی خطرے کا اشارہ نہیں۔ مل کر موو کی مشق کے لیے مختصر کال کافی ہے۔",
    helpUp: (reason: string) => `عام طور پر کال، مگر ${reason}۔ اس لیے کلاس میں دیکھیں۔`,
    fit: "مسئلہ کلاس کا ہے: سائز، بیٹھنے کی ترتیب یا وقت۔ کلاس دیکھ کر ایسی شکل نکالیں جو چلے۔",
    notRec: "ٹیچر نے جو بتایا وہ ریکارڈنگ میں نہیں، اس لیے رپورٹ اسے نہیں دکھا سکتی۔ کال کریں: ان کی بات پر بھروسہ کریں، پوچھیں کہ انہوں نے کیا کیا، اور اگلی بار پورا سبق ریکارڈ کرنا طے کریں۔",
  },
  reasons: {
    missed: (step: string, n: number, of: number) => `پچھلے ${of} میں سے ${n} اسباق میں ${step} رہ گیا۔ یہ عادت بن گئی ہے`,
    repeat: (nth: number) => `یہ ان کا ${nth}واں اختلاف ہے`,
    recordingLess: "وہ کم ریکارڈ کر رہی ہیں",
  },

  qs: "ان سے پوچھیں", stuck: "اگر وہ اٹک جائیں", agree: "کل کے لیے طے کریں", check: "اگلی ریکارڈنگ",
  rightCall: "ان کا شکریہ ادا کریں، اور بتائیں کہ رپورٹ دوبارہ چیک ہو رہی ہے۔",
  msgL: "تیار پیغام (آپ بدل سکتے ہیں)",
  send: "بھیجیں: ", send0s: " (واٹس ایپ)",
  sent: "واٹس ایپ کھل گیا۔ بات ہو جائے تو یہ کارڈ مکمل کر دیں۔",
  noPhone: "ان کا واٹس ایپ نمبر موجود نہیں۔ پیغام کاپی کر کے خود بھیجیں۔",
  autoFlag: "✓ رپورٹ جائزے کے لیے DC ٹیم کو بھیج دی گئی۔ اس کے لیے اور کچھ نہیں کرنا۔",
  undo: "واپس لیں", unflagged: "رپورٹ نشان زد نہیں ہوئی۔", reflag: "دوبارہ نشان زد کریں",
  addVisit: "میرے اگلے دورے میں شامل کریں", added: "آپ کے اگلے دورے میں شامل ہو گیا۔",
  noVisit: "اس کے لیے دورے کی ضرورت نہیں۔ پیغام کافی ہے۔",
  saveFailed: "محفوظ نہیں ہو سکا۔ انٹرنیٹ دیکھ کر دوبارہ کوشش کریں۔",
  thisPart: "اس حصے",

  tpl: {
    help: {
      qs: (s: string) => [`${s} میں آپ کیا چاہتی تھیں کہ ہو؟`, "ریکارڈنگ میں آپ کو کیا سنائی دیا؟", "کل آپ ایک چیز کیا بدلیں گی؟"],
      stuck: (s: string) => [`${s} میں موو ایک بار خود کر کے دکھائیں، پھر وہ آپ کے ساتھ کریں۔`, "وہ اپنے سبق کے کسی لفظ کے ساتھ جملہ دو بار آپ کے ساتھ بولیں۔"],
      visit: (s: string) => [`${s} کے دوران کلاس میں بیٹھیں۔`, "ایک قطار کے ساتھ موو کر کے دکھائیں، پھر اگلی قطار کے ساتھ وہ کریں۔", "بعد میں کل کے لیے موو طے کریں۔"],
      agree: (s: string) => `کل ${s} میں موو ایک بار آزمائیں۔`,
      check: (s: string) => `کیا انہوں نے ${s} میں موو کیا؟`,
    },
    fit: {
      qs: (s: string) => [`${s} میں آپ کیا چاہتی تھیں کہ ہو؟`, "آپ کی کلاس میں کیا رکاوٹ ہے؟", "کل کون سی چھوٹی شکل چل سکتی ہے؟"],
      stuck: (_s: string) => ["پوچھیں کہ رکاوٹ کیا ہے: کلاس کا سائز، بیٹھنے کی ترتیب یا وقت۔", "چھوٹی شکل طے کریں: صرف پہلی دو قطاریں، یا سبق میں کم بار۔"],
      visit: (s: string) => [`${s} کے دوران دیکھیں کہ بچے کیسے بیٹھے ہیں۔`, "موو صرف پہلی دو قطاروں کے ساتھ آزمائیں۔", "کل کے لیے یہی شکل طے کریں۔"],
      agree: (_s: string) => "چھوٹی شکل، صرف پہلی دو قطاروں میں۔",
      check: (_s: string) => "کیا انہوں نے چھوٹی شکل آزمائی؟",
    },
    notRec: {
      qs: (s: string) => [`ریکارڈنگ رکنے کے بعد آپ نے ${s} میں کیا کیا؟`, "بچوں نے کیسے حصہ لیا؟", `کیا اگلی بار پورا سبق، یا کم از کم ${s}، ریکارڈ کر سکتی ہیں؟`],
      stuck: (s: string) => [`اگر پورا سبق ریکارڈ نہ ہو سکے تو طے کریں کہ ${s} سے ذرا پہلے ریکارڈنگ شروع کریں۔`, "فون کی جگہ (storage) اور بیٹری مل کر دیکھیں۔"],
      visit: (_s: string) => ["دیکھیں کہ وہ کیسے ریکارڈ کرتی ہیں: فون کہاں رکھا ہے، جگہ اور بیٹری۔", "سبق سے پہلے مل کر ریکارڈنگ شروع کریں۔", "پورا سبق ریکارڈ کرنا طے کریں۔"],
      agree: (s: string) => `اگلی بار پورا سبق ریکارڈ کریں، یا کم از کم ${s} شروع سے آخر تک۔`,
      check: (s: string) => `کیا ریکارڈنگ 30 منٹ سے لمبی ہے، اور کیا اس میں ${s} ہے؟`,
    },
  },
});
