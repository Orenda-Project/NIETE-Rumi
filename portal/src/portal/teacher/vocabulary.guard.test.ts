import { describe, it, expect } from "vitest";
import { COPY_MODULES } from "./copyRegistry";

/**
 * bd-fmf24g.17 — the vocabulary guard. The teacher app has ONE word per concept in English and in Urdu
 * (.claude/skills/teacher-portal-design/reference/instances/ict-niete-ontology.md). This walks every
 * registered copy module (copyRegistry), strings and what each function returns, and fails on a word the
 * ontology lists under "Never", so a new screen cannot bring a second word for a concept back in.
 *
 * Two lists:
 *  - BANNED: a word that must not appear anywhere in the copy (a path can be exempted with a reason).
 *  - PINNED: the decided words at a path, English and Urdu.
 *
 * Add to the lists when the ontology gains a row; delete a ban only when the ontology drops the "Never".
 */

type Leaf = { screen: string; path: string; lang: "en" | "ur"; text: string };

const SAMPLES: unknown[][] = [[3, 7], ["Math", "Sci"], []];

function walk(screen: string, lang: "en" | "ur", node: unknown, path: string, out: Leaf[]) {
  if (typeof node === "string") {
    out.push({ screen, path, lang, text: node });
  } else if (typeof node === "function") {
    for (const args of SAMPLES) {
      try {
        const v = (node as (...a: unknown[]) => unknown)(...args);
        if (typeof v === "string") out.push({ screen, path: `${path}()`, lang, text: v });
      } catch { /* a function that needs other arguments: its strings are the module's own */ }
    }
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walk(screen, lang, v, `${path}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) walk(screen, lang, (node as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
  }
}

const LEAVES: Leaf[] = [];
for (const m of COPY_MODULES) {
  walk(m.screen, "en", m.module.en, "", LEAVES);
  walk(m.screen, "ur", m.module.ur, "", LEAVES);
}

type Ban = { lang: "en" | "ur"; re: RegExp; use: string };

const BANNED: Ban[] = [
  // ---- English
  { lang: "en", re: /\bLessons\b/, use: "Lesson Plans (the feature); a taught lesson is lowercase" },
  { lang: "en", re: /\bOther lessons\b/i, use: "Other lesson plans" },
  { lang: "en", re: /\bPreparing\b/, use: "Being made" },
  { lang: "en", re: /\bWriting\b/, use: "Being made" },
  { lang: "en", re: /\bLogout\b/, use: "Log out" },
  { lang: "en", re: /\b(Choose|Pick)\b|\bpicked\b/i, use: "Select" },
  { lang: "en", re: /\bCh \d/, use: "Chap 1" },
  { lang: "en", re: /\bHow many\b/, use: "Questions / Per type" },
  { lang: "en", re: /^Key$/, use: "Answer key" },
  { lang: "en", re: /\bNot loaded\b/, use: "Could not load" },
  { lang: "en", re: /\bNothing here\b/, use: "Nothing yet" },
  { lang: "en", re: /\bWritten quiz\b/, use: "Written exam" },
  { lang: "en", re: /^\d+ Q$/, use: "N questions" },
  { lang: "en", re: /\bAnalyz/i, use: "Analysing" },
  { lang: "en", re: /\bAny [Gg]rade\b/, use: "Select grade and subject" },
  { lang: "en", re: /\bAll lesson plans\b/, use: "All Lesson Plans" },
  { lang: "en", re: /\bAll DC observations\b|\bAll Digital Coaching\b/, use: "All DC Observations" },
  { lang: "en", re: /\bYour lesson\b/, use: "Your recording" },
  { lang: "en", re: /^Open (that )?lesson$|^Lesson not found$/, use: "Open DC observation / DC observation not found" },
  { lang: "en", re: /\bLesson received\b|\bListening to lesson\b|\bChecking your teaching\b/, use: "Analysing" },
  { lang: "en", re: /\bMake paper\b/, use: "Make my paper" },
  { lang: "en", re: /\bSend to WhatsApp\b/, use: "Send on WhatsApp" },
  { lang: "en", re: /^WhatsApp$/, use: "Sent on WhatsApp / Send on WhatsApp" },
  { lang: "en", re: /\bEdit teaching level\b/, use: "Change teaching level" },
  { lang: "en", re: /\bMaths\b|\bAgricul\b|\bSoc\. St\b|\bPak\. St\b|\bGen\. Kn\b|\bGeogr\b/, use: "the short forms in ontology section 6" },
  { lang: "en", re: /\bClassroom Coaching\b|\bRecord live lecture\b/, use: "Digital Coaching / Record lesson" },
  { lang: "en", re: /\bOpens by itself\b/i, use: "no chip: the plan still opens by itself, the page does not say so" },
  { lang: "en", re: /\bModules?\b/, use: "Course exam / Courses done / Part: the teacher sees Course and Part, never Module (item 8, 2026-10-09)" },
  // ---- Urdu
  { lang: "ur", re: /ماڈیول/, use: "کورس (Course) or حصہ (Part): never ماڈیول (item 8, 2026-10-09)" },
  { lang: "ur", re: /سبق #/, use: "پلان #" },
  { lang: "ur", re: /بدلیں/, use: "Change = تبدیل کریں; Edit = ترمیم کریں" },
  { lang: "ur", re: /بھیج دیا|بھیجے/, use: "بھیجا گیا" },
  { lang: "ur", re: /استاد/, use: "ٹیچر" },
  { lang: "ur", re: /بن رہا|تیار ہو رہے ہیں/, use: "تیار ہو رہا ہے" },
  { lang: "ur", re: /^لوڈ نہیں ہوا$/, use: "لوڈ نہیں ہو سکا" },
  { lang: "ur", re: /کوئز/, use: "فوری جانچ (a Quick check) or امتحان (an exam)" },
  { lang: "ur", re: /سبق کا منصوبہ/, use: "لیسن پلان" },
  { lang: "ur", re: /اسباق/, use: "لیسن پلان for plans; a count of taught lessons is only the report's journey" },
  { lang: "ur", re: /واٹس ایپ پر بھیجا$/, use: "واٹس ایپ پر بھیجا گیا" },
  // ---- Urdu review (bd-fmf24g.13, 2026-10-09): the house conventions, so a later draft cannot drift back
  { lang: "ur", re: /تیار نہیں ہو سکا/, use: "نہیں بن سکا (Failed / Couldn't make it)" },
  { lang: "ur", re: /(?<!لیسن )پلان(?! #| کی تصویر)/, use: "لیسن پلان (Plan alone only in پلان # and پلان کی تصویر)" },
  { lang: "ur", re: /پرچہ (میں|پر|سے|کا|کی|کے)(\s|$)/, use: "پرچے before a postposition (پرچے میں)" },
  { lang: "ur", re: /~/, use: "تقریباً N منٹ: a tilde means nothing to an Urdu reader" },
  { lang: "ur", re: /\+\d/, use: "مزید N: a leading plus flips to the wrong side in RTL" },
  { lang: "ur", re: /\d\s+(مزید\s+)?کورسز/, use: "N کورس: a counted noun stays singular, as N سوال, N لیسن پلان" },
  { lang: "ur", re: /^سب \d/, use: "تمام N" },
  { lang: "ur", re: /^کلاسیں شامل$/, use: "شامل کلاسیں" },
  { lang: "ur", re: /کوئی کارکردگی/, use: "ابھی کارکردگی دستیاب نہیں (no band is not 'no performance')" },
  { lang: "ur", re: /کچھ نہیں لگا/, use: "ابھی حاضری نہیں لگی" },
  { lang: "ur", re: /تبدیلی بند/, use: "ترمیم بند (Edit = ترمیم)" },
  { lang: "ur", re: /^جانچیں اور/, use: "دیکھیں اور … (Check and send / Check and make: one verb)" },
  // Gender: the teacher is addressed with an imperative or an impersonal phrase, never a gendered verb.
  { lang: "ur", re: /آپ (?!کا|کی|کے)[^،۔]*?(سکتے|سکتی|رہے|رہی|تھے|تھی|چکے|چکی|گئے|گئی)(\s|$|۔)/, use: "an imperative or an impersonal phrase (آپ کی حاضری; انتظار ضروری نہیں)" },
  // Mechanics: Western digits (as the bot's catalog), Urdu letters (not their Arabic look-alikes), Urdu punctuation.
  { lang: "ur", re: /[\u0660-\u0669\u06F0-\u06F9]/, use: "Western digits 0-9, as the bot" },
  { lang: "ur", re: /[\u064A\u0643\u0647\u0629\u0649]/, use: "Urdu ی ک ہ, not Arabic ي ك ه" },
  { lang: "ur", re: /[\u0600-\u06FF]\s*[,?;]|[\u0600-\u06FF]\.(\s|$)/, use: "Urdu punctuation ، ؟ ۔" },
];

/** A leaf exempt from the bans, with the ontology's reason. */
const EXEMPT: Array<{ path: RegExp; why: string }> = [
  { path: /^report\.(lessons|journeyAria)\(\)$/, why: "scores over N taught lessons: the class she taught, not a plan (ontology: Lesson)" },
];

describe("the vocabulary guard sees the copy", () => {
  it("walks both languages of every registered module", () => {
    expect(COPY_MODULES.length).toBeGreaterThan(8);
    expect(LEAVES.filter((l) => l.lang === "en").length).toBeGreaterThan(600);
    expect(LEAVES.filter((l) => l.lang === "ur").length).toBeGreaterThan(600);
  });
});

describe("no word the ontology lists under Never", () => {
  for (const ban of BANNED) {
    it(`${ban.lang}: ${ban.re} -> ${ban.use}`, () => {
      const hits = LEAVES.filter((l) => l.lang === ban.lang && ban.re.test(l.text))
        .filter((l) => !EXEMPT.some((e) => e.path.test(l.path)))
        .map((l) => `${l.screen} :: ${l.path} = "${l.text}"`);
      expect(hits, `use "${ban.use}"`).toEqual([]);
    });
  }
});

/** The decided words, by path inside the module, per screen. */
type Pin = { screen: string; path: string; en?: string; ur?: string };
const PINNED: Pin[] = [
  { screen: "frame (menu, Home, More, My profile)", path: "nav.lessons", en: "Lesson Plans", ur: "لیسن پلان" },
  { screen: "frame (menu, Home, More, My profile)", path: "more.logout", en: "Log out", ur: "لاگ آؤٹ" },
  { screen: "frame (menu, Home, More, My profile)", path: "profile.locked", en: "Locked", ur: "مقفل" },
  { screen: "Lesson Plans", path: "lessonPrefix", en: "LP #", ur: "پلان #" },
  { screen: "Lesson Plans", path: "title", en: "Lesson Plans", ur: "لیسن پلان" },
  { screen: "Lesson Plans", path: "all.title", en: "All Lesson Plans" },
  { screen: "Lesson Plans", path: "selectGradeSubject", en: "Select grade and subject" },
  { screen: "Lesson Plans", path: "all.whatsapp", en: "Sent on WhatsApp", ur: "واٹس ایپ پر بھیجا گیا" },
  { screen: "Lesson Plans", path: "otherLessons", en: "Other lesson plans", ur: "دوسرے لیسن پلان" },
  { screen: "Lesson Plans", path: "preparing", en: "Being made", ur: "تیار ہو رہا ہے" },
  { screen: "Lesson Plans", path: "startDc", en: "Start DC observation", ur: "ڈیجیٹل کوچنگ مشاہدہ شروع کریں" },
  { screen: "Lesson Plans", path: "nothingHere", en: "Nothing yet", ur: "ابھی کچھ نہیں" },
  { screen: "Digital Coaching", path: "allTitle", en: "All DC Observations" },
  { screen: "Digital Coaching", path: "yourRecording", en: "Your recording", ur: "آپ کی ریکارڈنگ" },
  { screen: "Digital Coaching", path: "notFound", en: "DC observation not found" },
  { screen: "Digital Coaching", path: "openLesson", en: "Open DC observation" },
  { screen: "Digital Coaching", path: "lessonPlans", en: "Lesson Plans" },
  { screen: "Digital Coaching", path: "sent", ur: "بھیجا گیا" },
  { screen: "Digital Coaching", path: "stop", ur: "ختم کریں" },
  { screen: "Digital Coaching", path: "stopListening", ur: "ختم کریں" },
  { screen: "Digital Coaching", path: "analysing", en: "Analysing", ur: "تجزیہ جاری" },
  { screen: "Digital Coaching", path: "noneYet", ur: "ابھی کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں" },
  { screen: "Digital Coaching", path: "kpiLatestBand", ur: "تازہ ترین کارکردگی" },
  { screen: "Digital Coaching", path: "picker.notLoaded", en: "Could not load", ur: "لوڈ نہیں ہو سکا" },
  { screen: "Digital Coaching", path: "picker.chooseFile", en: "Select file", ur: "فائل چنیں" },
  { screen: "My Classes", path: "lessonPlans", en: "Lesson Plans" },
  { screen: "Assessment", path: "makePaper", en: "Make my paper", ur: "پرچہ بنائیں" },
  { screen: "Assessment", path: "edit", en: "Edit", ur: "ترمیم کریں" },
  { screen: "Assessment", path: "beingMade", en: "Being made", ur: "تیار ہو رہا ہے" },
  { screen: "Assessment", path: "howMany", en: "Questions" },
  { screen: "Assessment", path: "howManyEach", en: "Per type" },
  { screen: "Assessment", path: "key", en: "Answer key", ur: "جوابی کلید" },
  { screen: "Assessment", path: "chooseTypes", en: "Select types" },
  { screen: "Assessment", path: "nothingHere", en: "Nothing yet", ur: "ابھی کچھ نہیں" },
  { screen: "Attendance", path: "edit", ur: "ترمیم کریں" },
  { screen: "Attendance", path: "change", ur: "تبدیل کریں" },
  { screen: "Attendance", path: "chooseClass", en: "Select class" },
  { screen: "Attendance", path: "pickDate", en: "Select date" },
  { screen: "Attendance", path: "sent", ur: "واٹس ایپ پر بھیجا گیا" },
  { screen: "Attendance", path: "whatsapp", en: "Send on WhatsApp", ur: "واٹس ایپ پر بھیجیں" },
  { screen: "Analytics", path: "allLessonPlans", en: "All Lesson Plans" },
  { screen: "Analytics", path: "allDigitalCoaching", en: "All DC Observations" },
  { screen: "Analytics", path: "ratingOverTime", ur: "وقت کے ساتھ کارکردگی" },
  { screen: "Training", path: "locked", ur: "مقفل" },
  { screen: "Training (new-UI words reused)", path: "moduleExam", en: "Course exam", ur: "کورس امتحان" },
  { screen: "Analytics", path: "modulesDone", en: "Courses done", ur: "مکمل کورسز" },
  { screen: "Training", path: "edit", en: "Change", ur: "تبدیل کریں" },
  { screen: "Training", path: "editLevel", en: "Change teaching level" },
  { screen: "Training (new-UI words reused)", path: "locked", ur: "مقفل" },
  { screen: "Training (new-UI words reused)", path: "notLoaded", en: "Could not load", ur: "لوڈ نہیں ہو سکا" },
  { screen: "Training (new-UI words reused)", path: "writtenQuiz", en: "Written exam" },
  { screen: "kit (shared components)", path: "locked", en: "Locked", ur: "مقفل" },
  { screen: "kit (shared components)", path: "pickDates", en: "Select dates" },
  { screen: "kit (shared components)", path: "subjectShort.agriculture", en: "Agri" },
  // Urdu review (bd-fmf24g.13, 2026-10-09)
  { screen: "kit (shared components)", path: "subjectShort.pakistanStudies", en: "Pak St", ur: "پاکستان" },
  { screen: "Digital Coaching", path: "picker.failed", en: "Failed", ur: "نہیں بن سکا" },
  { screen: "Digital Coaching", path: "planNotUsed", ur: "لیسن پلان استعمال نہیں" },
  { screen: "Assessment", path: "editPaper", ur: "پرچے میں ترمیم کریں" },
  { screen: "Analytics", path: "youWerePresent", ur: "آپ کی حاضری" },
  { screen: "Analytics", path: "focus", ur: "توجہ طلب" },
  { screen: "Lesson Plans", path: "aboutTwoMinutes", ur: "تقریباً 2 منٹ" },
  { screen: "kit (shared components)", path: "notify.more(4)", ur: "مزید 4" },
  { screen: "kit (shared components)", path: "notify.timeLeft(4)", ur: "تقریباً 4 منٹ باقی" },
];

function find(screen: string, path: string, lang: "en" | "ur") {
  const call = path.match(/^(.*)\((.*)\)$/);
  const key = call ? call[1] : path;
  const at = (root: unknown) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), root);
  const node = COPY_MODULES.filter((m) => m.screen === screen).map((m) => at(m.module[lang])).find((v) => v !== undefined);
  if (call && typeof node === "function") return String((node as (...a: unknown[]) => unknown)(...(call[2] ? [call[2]] : [])));
  return node;
}

describe("the decided words stay decided", () => {
  for (const pin of PINNED) {
    if (pin.en !== undefined) it(`${pin.screen} :: ${pin.path} (en) = ${pin.en}`, () => expect(find(pin.screen, pin.path, "en")).toBe(pin.en));
    if (pin.ur !== undefined) it(`${pin.screen} :: ${pin.path} (ur) = ${pin.ur}`, () => expect(find(pin.screen, pin.path, "ur")).toBe(pin.ur));
  }
});
