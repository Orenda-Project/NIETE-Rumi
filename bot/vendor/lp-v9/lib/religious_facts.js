"use strict";
// RELIGIOUS FACTS — three mechanical checks on how a plan NAMES and CLASSIFIES surahs.
//
// VENDOR DIVERGENCE (SYNC.md §3.34, bd-nnd27p): Amena ruled three errors on the G11 Islamiat
// ch2 pp10-12 plan (2026-10-07), each a class any Islamiat plan can repeat:
//   1. «سورۃ طٰسٓمٓ» — disjoint letters (حروفِ مقطعات) used as a surah's name.
//   2. A Makki surah given as a Madani example (سورۃ الانعام), or the reverse.
//   3. Al-Ma'idah credited with the inheritance rulings, which are An-Nisa 4:11-12 and 4:176.
// The caller fails each under RELIGIOUS_MARKS, so it is never delivered and the ladder re-authors.
//
// Every check is built to stay SILENT when unsure, because a blocking false positive costs the
// teacher the whole lesson: a surah whose classification scholars dispute is never judged; a
// clause that names both مکی and مدنی, or negates, is never judged; a surah named with no
// مکی/مدنی context anywhere in its block or question is never judged. Pure — no I/O.

// [number, Makki (true) | Madani (false) | disputed (null), Urdu spellings, Latin spellings]
const SURAHS = [
  [1, true, ["الفاتحہ"], ["fatiha"]], [2, false, ["البقرہ"], ["baqarah"]],
  [3, false, ["آل عمران"], ["imran", "al imran", "ali imran"]], [4, false, ["النساء"], ["nisa"]],
  [5, false, ["المائدہ"], ["maidah"]], [6, true, ["الانعام"], ["anam"]], [7, true, ["الاعراف"], ["araf"]],
  [8, false, ["الانفال"], ["anfal"]], [9, false, ["التوبہ", "براءت"], ["tawbah", "taubah"]],
  [10, true, ["یونس"], ["yunus"]], [11, true, ["ہود"], ["hud"]], [12, true, ["یوسف"], ["yusuf"]],
  [13, null, ["الرعد"], ["rad"]], [14, true, ["ابراہیم"], ["ibrahim"]], [15, true, ["الحجر"], ["hijr"]],
  [16, true, ["النحل"], ["nahl"]], [17, true, ["بنی اسرائیل", "الاسراء"], ["isra", "bani israil"]],
  [18, true, ["الکہف"], ["kahf"]], [19, true, ["مریم"], ["maryam"]], [20, true, ["طہ"], ["taha"]],
  [21, true, ["الانبیاء"], ["anbiya"]], [22, null, ["الحج"], ["hajj"]], [23, true, ["المومنون"], ["muminun"]],
  [24, false, ["النور"], ["nur"]], [25, true, ["الفرقان"], ["furqan"]], [26, true, ["الشعراء"], ["shuara"]],
  [27, true, ["النمل"], ["naml"]], [28, true, ["القصص"], ["qasas"]], [29, true, ["العنکبوت"], ["ankabut"]],
  [30, true, ["الروم"], ["rum"]], [31, true, ["لقمان"], ["luqman"]], [32, true, ["السجدہ", "الم السجدہ"], ["sajdah"]],
  [33, false, ["الاحزاب"], ["ahzab"]], [34, true, ["سبا"], ["saba"]], [35, true, ["فاطر"], ["fatir"]],
  [36, true, ["یس"], ["yasin"]], [37, true, ["الصافات"], ["saffat"]], [38, true, ["ص"], ["sad"]],
  [39, true, ["الزمر"], ["zumar"]], [40, true, ["المومن", "غافر"], ["ghafir"]],
  [41, true, ["حم السجدہ", "فصلت"], ["fussilat"]], [42, true, ["الشوری"], ["shura"]],
  [43, true, ["الزخرف"], ["zukhruf"]], [44, true, ["الدخان"], ["dukhan"]], [45, true, ["الجاثیہ"], ["jathiyah"]],
  [46, true, ["الاحقاف"], ["ahqaf"]], [47, false, ["محمد"], []], [48, false, ["الفتح"], ["fath"]],
  [49, false, ["الحجرات"], ["hujurat"]], [50, true, ["ق"], ["qaf"]], [51, true, ["الذاریات"], ["dhariyat"]],
  [52, true, ["الطور"], ["tur"]], [53, true, ["النجم"], ["najm"]], [54, true, ["القمر"], ["qamar"]],
  [55, null, ["الرحمن"], ["rahman"]], [56, true, ["الواقعہ"], ["waqiah"]], [57, false, ["الحدید"], ["hadid"]],
  [58, false, ["المجادلہ"], ["mujadilah"]], [59, false, ["الحشر"], ["hashr"]], [60, false, ["الممتحنہ"], ["mumtahanah"]],
  [61, false, ["الصف"], ["saff"]], [62, false, ["الجمعہ"], ["jumuah"]], [63, false, ["المنافقون"], ["munafiqun"]],
  [64, null, ["التغابن"], ["taghabun"]], [65, false, ["الطلاق"], ["talaq"]], [66, false, ["التحریم"], ["tahrim"]],
  [67, true, ["الملک"], ["mulk"]], [68, true, ["القلم"], ["qalam"]], [69, true, ["الحاقہ"], ["haqqah"]],
  [70, true, ["المعارج"], ["maarij"]], [71, true, ["نوح"], ["nuh"]], [72, true, ["الجن"], ["jinn"]],
  [73, true, ["المزمل"], ["muzzammil"]], [74, true, ["المدثر"], ["muddaththir"]], [75, true, ["القیامہ"], ["qiyamah"]],
  [76, null, ["الدہر", "الانسان"], ["insan", "dahr"]], [77, true, ["المرسلات"], ["mursalat"]],
  [78, true, ["النبا"], ["naba"]], [79, true, ["النازعات"], ["naziat"]], [80, true, ["عبس"], ["abasa"]],
  [81, true, ["التکویر"], ["takwir"]], [82, true, ["الانفطار"], ["infitar"]], [83, null, ["المطففین"], ["mutaffifin"]],
  [84, true, ["الانشقاق"], ["inshiqaq"]], [85, true, ["البروج"], ["buruj"]], [86, true, ["الطارق"], ["tariq"]],
  [87, true, ["الاعلی"], ["ala"]], [88, true, ["الغاشیہ"], ["ghashiyah"]], [89, true, ["الفجر"], ["fajr"]],
  [90, true, ["البلد"], ["balad"]], [91, true, ["الشمس"], ["shams"]], [92, true, ["اللیل"], ["layl"]],
  [93, true, ["الضحی"], ["duha"]], [94, true, ["الم نشرح", "الانشراح"], ["sharh", "inshirah"]],
  [95, true, ["التین"], ["tin"]], [96, true, ["العلق"], ["alaq"]], [97, true, ["القدر"], ["qadr"]],
  [98, null, ["البینہ"], ["bayyinah"]], [99, null, ["الزلزال", "الزلزلہ"], ["zalzalah"]],
  [100, true, ["العادیات"], ["adiyat"]], [101, true, ["القارعہ"], ["qariah"]], [102, true, ["التکاثر"], ["takathur"]],
  [103, true, ["العصر"], ["asr"]], [104, true, ["الہمزہ"], ["humazah"]], [105, true, ["الفیل"], ["fil"]],
  [106, true, ["قریش"], ["quraysh"]], [107, true, ["الماعون"], ["maun"]], [108, true, ["الکوثر"], ["kawthar"]],
  [109, true, ["الکافرون"], ["kafirun"]], [110, false, ["النصر"], ["nasr"]], [111, true, ["اللہب", "تبت"], ["lahab", "masad"]],
  [112, null, ["الاخلاص"], ["ikhlas"]], [113, null, ["الفلق"], ["falaq"]], [114, null, ["الناس"], ["nas"]],
];

/** Fold the spellings Urdu and Arabic print for one word onto one key: no diacritics, one
 *  letter per sound, the article dropped. The same fold builds the table and reads the text. */
const foldUr = (s) => s
  .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[ةۃۂه]/g, "ہ")
  .replace(/ئ/g, "ی").replace(/ؤ/g, "و").replace(/ء/g, "");
const keyUr = (words) => words.map(foldUr).map((w) => (w.length > 2 && w.startsWith("ال") ? w.slice(2) : w)).join(" ");
const keyEn = (s) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/ee/g, "i").replace(/oo/g, "u")
  .replace(/(.)\1/g, "$1").replace(/h$/, "");

const BY_UR = new Map(), BY_EN = new Map();
for (const [n, makki, ur, en] of SURAHS) {
  for (const u of ur) BY_UR.set(keyUr(u.split(" ")), { n, makki });
  for (const e of en) BY_EN.set(keyEn(e), { n, makki });
}
const NAME = (n) => SURAHS[n - 1][2][0];

const SURAH_UR = /سور(?:ۃ|ة|ۂ|ۂ|ہ)(?![ء-يٱ-ۓ])\s*/g;
const SURAH_EN = /\bS[uū]ra[ht]?\s+(?:[Aa](?:l|n|r|s|sh|t|th|d|dh|z)[-\s‑])?([A-Za-z'’ʿʾ‑-]+(?:\s+[A-Z][A-Za-z'’ʿʾ‑-]+)?)/g;
const STOP = /[،,.۔؛;:()[\]«»"'“”—–\-!?؟\n0-9۰-۹]/;

// Disjoint letters that open a surah but are not its name, and the surahs each opens.
const MUQ = { "طسم": "الشعراء (26)، القصص (28)", "طس": "النمل (27)", "الم": "البقرہ، آل عمران، العنکبوت، الروم، لقمان، السجدہ",
  "المص": "الاعراف (7)", "الر": "یونس، ہود، یوسف، ابراہیم، الحجر", "المر": "الرعد (13)", "کہیعص": "مریم (19)",
  "حم": "المومن سے الاحقاف (40-46)", "عسق": "الشوری (42)", "حمعسق": "الشوری (42)" };
const MUQ_NAME_TAIL = new Set(["سجدہ", "السجدہ", "تنزیل", "نشرح"]); // «حٰمٓ السجدہ», «الٓمٓ السجدہ», «الم نشرح»
const MUQ_EN = /\bS[uū]ra[ht]?\s+(Ta[-\s‑]?Sin(?:[-\s‑]?Mim)?|Alif[-\s‑]?Lam[-\s‑]?(?:Mim|Ra)(?:[-\s‑]?(?:Sad|Ra))?|Ha[-\s‑]?Mim(?![-\s‑]*Sajda))\b/gi;

// A label counts only where it classifies SURAHS or VERSES — «مدنی سورتیں», «سورۃ … مدنی ہے»,
// "a Makki surah". «مدنی معاشرہ» (Madinan society) beside «سورۃ النور» is not a classification.
const labelRe = (ur, en) => new RegExp(
  `(?:${ur})\\s+(?:سورت|سورۃ|سورہ|آیات|آیت)|(?:سورت|سورۃ|سورہ)[^۔،]{0,40}(?:${ur})` +
  `|\\b(?:${en})\\s+(?:s[uū]ra|verse|ayat)|\\bs[uū]ra[^.]{0,40}\\b(?:${en})\\b`, "i");
const MAKKI = labelRe("مکی|مکّی", "makk[ai]n?|meccan");
const MADANI = labelRe("مدنی", "madan[iy]|madinan|medinan");
// Negation, and exception: «البقرہ اور آلِ عمران کے علاوہ … وہ سب مکی ہیں» names the two it EXCLUDES.
const NEGATION = /نہیں|علاوہ|سوائے|\bnot\b|n['’]t\b|\bexcept\b|\bother than\b|\bapart from\b/i;
const INHERIT = /وراثت|میراث|ترکہ|\binherit/i;
const CLAUSE = /[۔؛;\n.!?؟]/;

/** Every surah a string names, with where it sits and what the plan wrote. */
function citations(s) {
  const out = [];
  SURAH_UR.lastIndex = 0;
  let m;
  while ((m = SURAH_UR.exec(s))) {
    const rest = s.slice(m.index + m[0].length);
    const stop = rest.search(STOP);
    const words = (stop < 0 ? rest : rest.slice(0, stop)).trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const raw = words.map(foldUr);
    if (MUQ[raw[0]] && !MUQ_NAME_TAIL.has(raw[1])) {
      out.push({ i: m.index, text: m[0] + words[0], muq: raw[0] });
      continue;
    }
    for (let k = words.length; k > 0; k--) {
      const hit = BY_UR.get(keyUr(words.slice(0, k)));
      if (hit) { out.push({ i: m.index, text: (m[0] + words.slice(0, k).join(" ")).trim(), ...hit }); break; }
    }
  }
  SURAH_EN.lastIndex = 0;
  while ((m = SURAH_EN.exec(s))) {
    const hit = BY_EN.get(keyEn(m[1])) || BY_EN.get(keyEn(m[1].split(/\s+/)[0]));
    if (hit) out.push({ i: m.index, text: m[0], ...hit });
  }
  MUQ_EN.lastIndex = 0;
  while ((m = MUQ_EN.exec(s))) out.push({ i: m.index, text: m[0], muq: m[1] });
  return out;
}

/** "makki" | "madani" | null — what a stretch of text says the surahs in it are. */
function label(text) {
  if (NEGATION.test(text)) return "none";
  const mk = MAKKI.test(text), md = MADANI.test(text);
  return mk && md ? "both" : mk ? "makki" : md ? "madani" : null;
}

/** The clause around position i, cut at sentence ends; narrowed to the comma-phrase when the
 *  sentence names both kinds ("مکی کی مثال الاخلاص ہے، اور مدنی کی مثال البقرہ"). */
function contextAt(s, i) {
  const cut = (txt, at, re) => {
    let a = at; while (a > 0 && !re.test(txt[a - 1])) a--;
    let b = at; while (b < txt.length && !re.test(txt[b])) b++;
    return [txt.slice(a, b), at - a];
  };
  const [clause, j] = cut(s, i, CLAUSE);
  const l = label(clause);
  if (l !== "both") return { clause, label: l };
  const [phrase] = cut(clause, j, /[،,]/);
  const pl = label(phrase);
  return { clause, label: pl === null ? "none" : pl };
}

/** The question or block a string belongs to — the unit whose wording supplies its context. */
function unitOf(at) {
  const m = at.match(/^\/sections\/\d+\/homework\/items\/\d+/) || at.match(/^\/page2\/[a-z_]+\/(?:[a-z_]+\/)?\d+/)
    || at.match(/^\/sections\/\d+\/blocks\/\d+(?:\/(?:left|right)\/\d+)?/) || at.match(/^\/sections\/\d+\/[a-z_]+/);
  return m ? m[0] : at.replace(/\/[^/]*$/, "");
}

/**
 * @param {{at: string, s: string}[]} strings  the teacher-facing strings of one plan
 * @returns {{at: string, msg: string}[]}       one entry per defect; empty when clean
 */
function religiousFactDefects(strings) {
  const units = new Map();
  for (const x of strings) {
    const u = unitOf(x.at);
    if (!units.has(u)) units.set(u, []);
    units.get(u).push(x);
  }
  // A key or model answer is read against the question it answers, matched on `ref`.
  const refOf = (u) => (units.get(u).find((x) => x.at.endsWith("/ref")) || {}).s;
  const questionText = new Map();
  for (const u of units.keys()) if (/\/homework\/items\/\d+$/.test(u) && refOf(u)) {
    questionText.set(refOf(u), units.get(u).map((x) => x.s).join(" "));
  }
  const unitText = (u) => units.get(u).map((x) => x.s).join(" ") + " " + (questionText.get(refOf(u)) || "");

  const out = [];
  for (const [u, xs] of units) for (const { at, s } of xs) {
    for (const c of citations(s)) {
      if (c.muq) {
        out.push({ at, msg: `${at} uses disjoint letters as a surah's name: «${c.text}». ${c.muq} are حروفِ مقطعات — the opening verse of ${MUQ[foldUr(c.muq)] || "a surah"}, not a name. Name the surah itself (Amena ruling 2026-10-07).` });
        continue;
      }
      const { clause, label: l } = contextAt(s, c.i);
      if (c.n === 5 && INHERIT.test(clause) && ![...citations(clause)].some((o) => o.n === 4)) {
        out.push({ at, msg: `${at} credits the inheritance rulings to سورۃ المائدہ: "${clause.trim().slice(0, 90)}". The shares of inheritance are in سورۃ النساء (4:11-12, 4:176). Al-Ma'idah's own rulings include wudu (5:6) and halal/haram food (5:3-5) (Amena ruling 2026-10-07).` });
      }
      if (c.makki === null || c.makki === undefined) continue;
      const ctx = l !== null ? l : label(unitText(u));
      if (ctx !== "makki" && ctx !== "madani") continue;
      if ((ctx === "madani") === !c.makki) continue;
      const is = c.makki ? "مکی (Makki)" : "مدنی (Madani)", given = ctx === "madani" ? "Madani" : "Makki";
      out.push({ at, msg: `${at} gives «${c.text}» as a ${given} example, but ${NAME(c.n)} (${c.n}) is ${is}: "${s.slice(Math.max(0, c.i - 40), c.i + 40)}". Use an undisputed ${given} surah (${ctx === "madani" ? "البقرہ، آل عمران، النساء، الانفال" : "العصر، الکوثر، المزمل، الانعام"}) or drop the example — even where the textbook page prints this one (G11 Islamiat p.11 does) (Amena ruling 2026-10-07).` });
    }
  }
  return out;
}

module.exports = { religiousFactDefects };
