'use strict';
/**
 * R9 aligned picks (bd-tp4w7n.1, COS 20261119T115204 §R9.3; the operator, 19 Nov: "it should focus on videos that are
 * demonstrating how the teacher might execute the topic area and must be aligned with what the report is asking them
 * to do"). Behind VIDEO_RECO_ALIGNED (flags.js); off = today's engine, byte for byte.
 *
 *   1. classifyAsk: the card's ONE ask, read from its main clause (the «Next class, when …,» trigger is not the ask):
 *      a move and the sub-ask inside it, or null. A card whose main clause leads with a move no clip shows (a
 *      differentiation, an «explain in your own words» check, an end-of-lesson pair reflection, feedback, a goal on the
 *      board, a label card) is null: silence.
 *   2. candidates: catalogue v2 chapters that pass lib's engine contract (contracts/catalog.v2.schema.md §B: kind
 *      demonstration | modelled, shows.move = the ask, usable span, sound not poor, no dup_of) AND carry a sub-ask record
 *      equal to the card's (ped-align ALLOWLIST.md 20261119T140916: "match on the sub-ask, not on the move label alone").
 *      Gates as the panel paired them (ped-align bin/gates.py: language, subject, grade). Never a chapter already shown,
 *      never a video already shown (a dup's canonical copy counts as the same video). No fallback to another move.
 *   3. reasonFor: "Your report asked you to <the ask>. This clip shows <what the chapter shows>." in en and ur.
 *
 * Pure: no I/O, no LLM. A chapter with no SUB_ASK record never fires (fail closed): a new allowlist entry ships with one.
 */
const { stripBidi } = require('./copy');
const { resolveUx } = require('../../../config/ux-strings');

const SUB_ASKS = Object.freeze({
  // ask texts are clauses after "Your report asked you to" / «آپ کی رپورٹ نے کہا تھا کہ»
  'wait_time:after_question': {
    move: 'wait_time',
    ask_en: 'wait a few seconds after a question before anyone answers',
    ask_ur: 'سوال کے بعد جواب لینے سے پہلے چند سیکنڈ انتظار کریں',
  },
  'think_pair_share:think_then_pair': {
    move: 'think_pair_share',
    ask_en: 'let students think, then talk in pairs before answering',
    ask_ur: 'بچوں کو پہلے سوچنے، پھر جوڑی میں بات کرنے کا موقع دیں، اس کے بعد جواب لیں',
  },
  'open_questions:why_observed': {
    move: 'open_questions',
    ask_en: 'ask an open "why" or "how" question instead of a yes/no one',
    ask_ur: 'ہاں/نہیں والے سوال کی جگہ "کیوں" یا "کیسے" والا کھلا سوال پوچھیں',
  },
  'follow_up_probe:why_chain': {
    move: 'follow_up_probe',
    ask_en: 'follow a short answer with "why?" and keep asking',
    ask_ur: 'مختصر جواب کے بعد "کیوں؟" پوچھیں اور سوال جاری رکھیں',
  },
  'ask_for_reasoning:why_after_observation': {
    move: 'ask_for_reasoning',
    ask_en: 'ask students to explain why something happened',
    ask_ur: 'بچوں سے پوچھیں کہ کوئی چیز کیوں ہوئی',
  },
  'attention_cue:call_response': {
    move: 'attention_cue',
    ask_en: 'use a signal to get the class\'s attention',
    ask_ur: 'کلاس کی توجہ لینے کے لیے ایک اشارہ استعمال کریں',
  },
  'inquiry_opening:object_question': {
    move: 'inquiry_opening',
    ask_en: 'open the lesson with something to look at and one question',
    ask_ur: 'سبق کا آغاز کسی چیز کو دکھا کر اور ایک سوال سے کریں',
  },
  'activate_prior_knowledge:recall_first': {
    move: 'activate_prior_knowledge',
    ask_en: 'ask what students already know before the new topic',
    ask_ur: 'نیا موضوع شروع کرنے سے پہلے پوچھیں کہ بچے پہلے سے کیا جانتے ہیں',
  },
});

/**
 * The chapters ped-align cleared (ALLOWLIST.md, 20261119T140916; red7 PASS 20261119T141012), with the sub-ask each shows
 * and what the teacher sees, in words the panel's quoted transcript lines support (RELEVANCE.md). Gender-neutral.
 */
const SUB_ASK = Object.freeze({
  '790-s3': { sub: 'wait_time:after_question', shows_en: 'a trainer asking a question, stopping early answers and giving everyone time to think alone first', shows_ur: 'ایک ٹرینر سوال پوچھ کر فوری جواب روکتے ہیں اور سب کو پہلے اکیلے سوچنے کا وقت دیتے ہیں' },
  '791-s2': { sub: 'think_pair_share:think_then_pair', shows_en: 'a trainer saying "first think separately… now think together", then calling on one group to answer', shows_ur: 'ایک ٹرینر کہتے ہیں "پہلے الگ الگ سوچیں… اب مل کر سوچیں"، پھر ایک گروپ سے جواب لیتے ہیں' },
  '451-s3': { sub: 'think_pair_share:think_then_pair', shows_en: 'a class talking in pairs first, while the teacher holds back one student until the pairs have talked', shows_ur: 'ایک کلاس پہلے جوڑیوں میں بات کرتی ہے، اور ٹیچر ایک بچے کو تب تک روکتے ہیں جب تک جوڑیاں بات نہ کر لیں' },
  '95-s1': { sub: 'open_questions:why_observed', shows_en: 'a teacher asking "why do you think summers are getting hotter?" about something the class has seen', shows_ur: 'ایک ٹیچر بچوں کے دیکھے ہوئے موسم پر پوچھتے ہیں: "تمہارے خیال میں گرمیاں زیادہ گرم کیوں ہو رہی ہیں؟"' },
  '782-s1': { sub: 'follow_up_probe:why_chain', shows_en: 'a teacher with two plants asking "why?" after each child\'s answer until the class reasons it out', shows_ur: 'ایک ٹیچر دو پودے دکھا کر ہر بچے کے جواب پر "کیوں؟" پوچھتے ہیں، یہاں تک کہ کلاس خود وجہ تک پہنچ جائے' },
  '177-s4': { sub: 'ask_for_reasoning:why_after_observation', shows_en: 'questions like "why did the heavier object move slower?" asked right after students watch it happen', shows_ur: 'بچوں کے دیکھنے کے فوراً بعد ایسے سوال: "بھاری چیز آہستہ کیوں چلی؟"' },
  '3-s2': { sub: 'attention_cue:call_response', shows_en: 'a teacher saying "one, two, three!" and the class answering "eyes on me!" with a clap', shows_ur: 'ٹیچر "ون، ٹو، تھری!" کہتے ہیں اور بچے تالی کے ساتھ "آئیز آن می!" جواب دیتے ہیں' },
  '481-s2': { sub: 'inquiry_opening:object_question', shows_en: 'a teacher opening with a bag of school rubbish and one question, then 30 seconds to think before pair talk', shows_ur: 'ایک ٹیچر اسکول کے کچرے کا تھیلا دکھا کر ایک سوال سے سبق شروع کرتے ہیں، پھر 30 سیکنڈ سوچنے اور جوڑی میں بات کا وقت' },
  '722-s2': { sub: 'activate_prior_knowledge:recall_first', shows_en: 'a teacher holding up a picture of Earth and asking what the children already know before naming the topic', shows_ur: 'ایک ٹیچر زمین کی تصویر دکھا کر موضوع بتانے سے پہلے پوچھتے ہیں کہ بچے کیا جانتے ہیں' },
  // R9c second clips (ped-align ADDON.md 20261119T174039: 20/20 R+A each, 0 ⛔; red7 PASS 175254; COS 174101). `tier` 1
  // ranks them after the 9 first clips, so first contact is unchanged; 790-s2 is tier 2, last, since showing it would
  // close video 790 and with it 790-s3 (red7 N1). 794-s2 is write-alone-then-four: never below Grade 3 (4 of 24 G1–2
  // votes wrong). 778-s2 is held (red7 HOLD 175254: the transcript shows a check-in, not a question and a held wait).
  '790-s2': { sub: 'think_pair_share:think_then_pair', tier: 2, shows_en: 'a trainer asking everyone to think of the answer alone first, then put heads together and agree on the best answer', shows_ur: 'ایک ٹرینر سب سے کہتے ہیں کہ پہلے اکیلے ذہن میں جواب سوچیں، پھر مل کر بہترین جواب طے کریں' },
  '804-s2': { sub: 'think_pair_share:think_then_pair', tier: 1, shows_en: 'adult participants thinking and writing alone, then talking in pairs, then sharing the pair\'s ideas at the board', shows_ur: 'بڑے شرکاء پہلے اکیلے سوچ کر لکھتے ہیں، پھر جوڑی میں بات کرتے ہیں، پھر جوڑی کے خیالات بورڈ پر سب کو بتاتے ہیں' },
  '905-s5': { sub: 'think_pair_share:think_then_pair', tier: 1, shows_en: 'a teacher giving students 2 minutes to settle three facts on their own, then pairs to discuss their story', shows_ur: 'ایک ٹیچر طلبہ کو 2 منٹ دیتے ہیں کہ خود تین باتیں طے کریں، پھر جوڑی میں اپنی کہانی پر بات کریں' },
  '794-s2': { sub: 'think_pair_share:think_then_pair', tier: 1, grade_min: 3, shows_en: 'a trainer asking everyone to write their answer alone, then after a minute moving into groups of four to compare and correct', shows_ur: 'ایک ٹرینر سب سے پہلے اکیلے جواب لکھواتے ہیں، پھر ایک منٹ بعد چار کے گروپ میں جواب ملا کر درست کرواتے ہیں' },
  '745-s1': { sub: 'think_pair_share:think_then_pair', tier: 1, shows_en: 'adult participants each listing five qualities of a good teacher, then making one list in pairs, then in fours', shows_ur: 'بڑے شرکاء پہلے اکیلے اچھے ٹیچر کی پانچ خوبیاں لکھتے ہیں، پھر جوڑی میں ایک فہرست بناتے ہیں، پھر چار کے گروپ میں' },
  '451-s1': { sub: 'wait_time:after_question', tier: 1, shows_en: 'a teacher setting the rule of 10 seconds to think and no calling out, then holding back a student who wants to answer first', shows_ur: 'ایک ٹیچر اصول بتاتے ہیں: سوچنے کے 10 سیکنڈ اور بیچ میں کوئی نہ بولے، پھر جلدی جواب دینے والے ایک بچے کو روکتے ہیں' },
});

// --- 1. the card's ask -------------------------------------------------------------------------------------------------

// Quoted spans (the card's example question) are masked while the clause is cut, so a comma inside a quote never ends it.
const QUOTE = /'[^'\n]{0,160}'|‘[^’\n]{0,160}’|"[^"\n]{0,160}"|“[^”\n]{0,160}”|«[^»\n]{0,160}»/gu;
// an apostrophe between two letters («the hair's movement») is text, not a quote mark (qa-e2e 20261119T215759): it would
// pair with the card's real quote and leave it unmasked. ʼ (U+02BC) keeps the length, so mainClause's offsets hold.
const APOSTROPHE = /(?<=\p{L})'(?=\p{L})/gu;
const mask = (s) => s.replace(APOSTROPHE, 'ʼ').replace(QUOTE, (q) => q[0] + '·'.repeat(Math.max(0, [...q].length - 2)) + q[q.length - 1]);
const ADDRESS = /^\s*(?:\[TEACHER\]\s*[،,:]?\s*)+/u;
const LEAD = /^\s*(?:next (?:class|lesson|time)[,،]?\s*|tomorrow[,،]?\s*|in (?:the|your) next (?:class|lesson)[,،]?\s*|اگلی (?:کلاس|بار)(?: میں)?[،,]?\s*)/iu;
// The trigger clause («when a student answers 'X',» / «جب … ، تو») names a moment, not the ask.
const TRIGGER_EN = /^(?:when|whenever|right after|after|before|as soon as|during|while|the moment|if|once)\b[^,،]*[,،]\s*/iu;
const TRIGGER_UR = /^(?:جب|جیسے ہی|اگر)[^،]*،\s*(?:تو\s+)?/u;

/** The card's main clause: its address, «Next class» and the when-clause dropped (quotes kept whole). */
function mainClause(sentence) {
  const raw = stripBidi(String(sentence || '')).replace(/\s+/g, ' ').trim();
  let m = mask(raw);
  let cut = 0;
  const drop = (rx) => { const x = rx.exec(m.slice(cut)); if (x) cut += x[0].length; return !!x; };
  drop(ADDRESS);
  drop(LEAD);
  // up to two leading triggers («during the comma practice, when a child answers in a word, …»)
  if (drop(TRIGGER_EN) || drop(TRIGGER_UR)) drop(TRIGGER_EN) || drop(TRIGGER_UR);
  m = m.slice(cut);
  return raw.slice(raw.length - m.length).trim();
}

// Moves no aligned clip shows. A card whose main clause LEADS with one is silent (never routed to a neighbour's clip).
const UNSHOWN = [
  ['own_words', /do you understand|own words|اپنے الفاظ|سمجھ (?:آیا|آئی|گئے)|اپنی زبان میں/iu],
  ['pair_reflection', /one thing (?:you|they) (?:have )?learn(?:ed|t)|questions? (?:you|they) still have|جو آپ نے سیکھی|ذہن میں ہے/iu],
  ['differentiate', /two versions|\btiers?\b|tiered|easier (?:and|or) (?:a )?harder|let (?:them|students|each) choose|choose (?:one|between|which)|struggling|advanced (?:pairs|students|learners)|باقی بچوں کو آسان|کمزور بچوں|support set|challenge set|دو حصے|دو گروپ|دو ورژن|آسان اور مشکل|سطح|لیول/iu],
  ['feedback', /good start|feedback|\bpraise\b|well done|next[- ]step|name what'?s right|\bsuggestion\b|شاباش|فیڈبیک|اچھی کوشش/iu],
  ['objective', /\bobjective\b|learning goal|success criteria|ہدف|مقصد/iu],
  ['label', /dedicat\w* \d+ minutes|spend (?:\d+|five|a few) minutes|specifically to improving|بہتر بنانے کے لیے/iu],
  ['silent_write', /\bwrite (?:down )?(?:their|your|its) own|quietly write|write (?:down )?[^.]{0,30}\bfirst\b|خاموشی سے لکھ|خود لکھ/iu],
  ['correction', /\bcorrect (?:it|them|their|the)\b|\bcorrections?\b|then[- ]correct|instead of correcting|غلطی (?:درست|ٹھیک)|غلطیوں کو[^۔]{0,30}(?:درست|ٹھیک)/iu],
  ['worksheet', /worksheet|exercise book|\bslates?\b|\bquiz\b|written test|کاپی میں/iu],
  ['model', /\bmodel(?:s|ling|led)?\b[^.;]{0,30}\b(?:example|sentence|answer|it|aloud|one|first)|\bmodel →|i do,? we do|ماڈل کر|مثال model|model کریں/iu],
  ['peer_check', /\bpartner\b[^.;]{0,15}\b(?:check|fix|correct|mark)|(?:check|fix|correct)\w*\b[^.;]{0,15}\b(?:with )?(?:a |their )?partner|peer[- ](?:check|assess|review)|checklist|rubric/iu],
  ['roles', /\broles?\b|کردار تقسیم/iu],
  ['closure', /exit (?:slip|ticket)|what (?:did )?(?:we|you|they) learn|at the end of (?:the )?(?:lesson|class|period)|کیا سیکھا|خلاصہ|سبق کے آخر/iu],
  ['sentence_stems', /sentence (?:starters?|stems?|frames?)|جملے کا آغاز/iu],
];
// Sub-asks that refuse ONE move's clip but never silence the card (they do not lead a card the way a task does).
// red7 H2: a child's explanation (in one sentence, the steps, why …) is not 95-s1's "why do you think…?" ; «instead of
// explaining yourself» names what the teacher should NOT do, so it is no explain.
const REFUSE_ONLY = [
  ['explain', /\bexplain (?:in (?:one|two|a|their|your|full)|your|their|why|how)\b|how would you explain|explain (?:your |their )?steps/iu],
];
// ped-align r5 (20261119T152426, 471 of the engine's own picks judged blind): a card whose main ask is another move gets a
// near-miss from the open-question and wait-time clips (95-s1 87.1%, 790-s3 91.8%). Read on the WHOLE card (the moment
// in the when-clause counts: wait time after a stumble is not 790-s3's wait after a question). COS 152504 §2.
const NEAR_MISS = [
  ['differentiate', /two (?:paths|versions|levels|tasks)|three (?:stations|levels)|\btiers?\b|tiered|struggl|quick(?:er)? (?:students|guessers|finishers)|early finishers|strongest|most students|for others|simpler (?:prompt|task|example)|easier|harder|stretch task|core task|challenge (?:task|set)|support set|\blevels?\b|کمزور|تیز (?:بچوں|طلبہ|بچے)|آسان|مشکل|باقی بچوں/iu],
  ['stumble', /\bstumbl|\bstall|\bhesita|\bpauses? (?:on|mid)|mid-sentence|reshap|comes out broken|پر (?:کوئی بچہ )?رکے|رکے،|رک جائے|اٹک/iu],
  // played media is the main move («play the audio», «a demo on the computer»); a classroom demo is 95-s1's observed
  // phenomenon, not one
  ['reading_model', /fluent model|poem audio|\baudio\b|\bplay (?:the |a )?(?:short )?(?:video|clip|audio|demo)|demo on the computer|role-play|آڈیو/iu],
  ['monitoring', /independent|on[- ]task|visible timer|row by row|circulate|گھوم کر|کے پاس جا کر/iu],
  ['behaviour', /noise|shouting|chatter|quiet look|شور/iu],
  ['feedback', /praise|shabaa|شاباش|تعریف|next step|feedback/iu],
  ['model', /\bmodel(?:ing|led|s)?\b|ماڈل/iu],
  ['exemplar', /exemplar/iu],
  ['sentence_task', /full sentence|sentence frame|complete[- ]the[- ]sentence|مکمل sentence|جملہ مکمل|sentence بنا/iu],
  ['lesson_plan', /lesson plan/iu],
  ['peer', /\bpeer|partner check|checklist/iu],
  ['board_work', /side-by-side|on the board first|بورڈ پر لکھیں/iu],
  // R9c (ped-align r6, 20261119T172641: 18 wrongs beyond 782-s1's `model`): the card's main step is another classroom
  // move with a why or a wait attached. Each pattern is a move no cleared clip shows.
  ['representation', /\bT-chart|\barrows?\b|\bdraw\b[^.;,]{0,25}\bon the board|show it on|دو کالم بنا|sorting activity/iu],
  ['scaffold', /offer (?:\w+ ){0,3}(?:hints|choices|options)|word choices/iu],
  ['resource', /word cards|flash ?cards/iu],
  ['task_choice', /let (?:them|students|the class|children|each \w+) choose/iu],
  ['closure_stem', /میں نے سیکھا|today I learned|سمجھ آ گئی/iu],
  ['hands_up', /raise (?:your |their )?hands?|how many of you|hands up/iu],
  ['pair_work', /pair (?:them|students|children) up|\bask pairs\b|pair[- ]check|\bthink \d+\s*s(?:ec(?:onds?)?)?,? (?:then )?pair/iu],
  ['timed_pairs', /\d+\s*s(?:ec(?:onds?)?)? (?:of )?(?:think|pair)|\d+\s*سیکنڈ کی (?:paired|pair|جوڑی)|paired discussion/iu],
  ['name_cards', /name cards|quieter students/iu],
  ['act_out', /act (?:it |them )?out|role-play/iu],
  ['no_hands', /one student alone|no[- ]hands/iu],
  ['sort_task', /\bsort\b|sort کروائیں/iu],
];
const NEAR_MISS_FOR = new Set(['open_questions', 'wait_time']);
// …and the near-misses that refuse one more move's clip (ped-align r6: `model` on follow_up_probe, 782-s1 183/193 →
// 179/185; the rest from the r6 wrongs, each priced on the 1,387 judged picks at #5141, eng-rec calib/r9c)
const NEAR_MISS_ONLY = Object.freeze({
  follow_up_probe: new Set(['model', 'representation', 'hands_up', 'pair_work']),
  think_pair_share: new Set(['exemplar']),
});
// one questioning ask in two steps, either order («ask why, then wait» / «wait, then ask why»)
const QUESTION_FAMILY = new Set(['open_questions', 'follow_up_probe', 'ask_for_reasoning', 'wait_time']);
// …and the one a given move's clip must not be read as (ped-align ALLOWLIST.md "match at this grain"; held-out wrongs)
const REFUSE = Object.freeze({
  open_questions: ['own_words', 'differentiate', 'explain'],
  think_pair_share: ['pair_reflection', 'peer_check', 'worksheet'],
  wait_time: ['silent_write', 'pair_reflection', 'peer_check', 'closure'],
  activate_prior_knowledge: ['closure', 'worksheet', 'correction'],
});

const WHY = /\bwhy\b|\bhow\b|کیوں|کیسے/iu;
// 790-s3 shows wait time AFTER A QUESTION, never a wait for latecomers, an instruction or copying (red7 N1 K3 K17 K18)
const QUESTION_NEAR = /question|\bask(?:s|ed|ing)?\b|answers?\b|respond|\bthink\b|\bwhy\b|\bhow\b|سوال|پوچھ|جواب|سوچ|کیوں|کیسے/iu;
// a follow-up is a further QUESTION (red7 K1 K14: «follow up with the students who missed homework»)
const FOLLOW_UP = /follow[- ]up (?:question|with\b[^.;]{0,40}(?:question|\bwhy\b|\bhow\b|['‘"“]))|(?:ask|pose) (?:an? |one )?(?:open[- ]ended )?follow[- ]up|open[- ]ended follow[- ]up|follow[- ]up (?:open[- ]ended )?(?:question|سوال)|probing question|probe (?:their|the|a|each) (?:answer|thinking|reasoning|idea)|follow-up open-ended question|مزید سوال|اور کوئی وجہ/iu;
const ASK_RX = Object.freeze({
  attention_cue: /attention (?:signal|cue)|cue to (?:regain|get) (?:their |the class'?s? )?attention|classroom cue to regain|(?:regain|get|gain) (?:the class'?s? |their )?attention|eyes on me|call[- ]and[- ]response|توجہ (?:کے لیے|لینے|حاصل)/iu,
  inquiry_opening: /\b(?:bring|hold up|show)\b[^.;]{0,30}\b(?:object|bag|jar|jars|bottle|bottles|plant|torch|mirror)\b[^.;]{0,60}\b(?:ask|question)|provocative (?:object|question)/iu,
  activate_prior_knowledge: /\b(?:ask|elicit)\b[^.;]{0,40}(?:already know|\brecall\b|remember)|what (?:do )?(?:they|you|students) (?:already )?know|prior knowledge|(?:پوچھیں|پوچھ کر)[^۔]{0,40}پہلے سے|پہلے سے (?:کیا )?(?:جانتے|معلوم)[^۔]{0,30}پوچھ|یاد (?:دلائیں|کروائیں)[^۔]{0,30}(?:پوچھ|سوال)|پہلے بچوں سے[^۔]{0,100}(?:مثالیں|پوچھیں)/iu,
  think_pair_share: /think[- ]pair[- ]share|think[- ]pair|turn[- ](?:and|to)[- ](?:talk|tell|your|a)|pair[- ]?(?:share|talk|discussion|discuss)|\bpairs?\b[^.;]{0,25}\b(?:discuss|talk|share|agree|compare)|(?:discuss|talk|share)\w*\b[^.;]{0,20}\bwith (?:a |their |your |the )?(?:partner|neighbou?r)|جوڑی(?:وں)? میں (?:بات|گفتگو|discuss|ڈسکس)|جوڑوں میں (?:بات|گفتگو|تقسیم|discuss|ڈسکس)|pair (?:discussion|میں بات)|ساتھی سے بات/iu,
  wait_time: /wait[- ]time|\bwait\s+(?:\d|a few|five|ten|several)|\d+\s*(?:[-–]\s*\d+\s*)?seconds? (?:of )?(?:silence|quiet|wait|think)|(?:silence|quiet) for \d|count silently|hold (?:your )?(?:\d|wait)|سیکنڈ (?:کا|کی)? ?(?:wait|انتظار|خاموش)|خاموشی سے (?:انتظار|wait)|wait time/iu,
  question: /follow[- ]up (?:question|with|open|سوال)|(?:ask|pose) (?:an? |one )?(?:open[- ]ended )?follow[- ]up|probing question|probe (?:their|the|a|each) (?:answer|thinking|reasoning|idea)|open[- ]ended|open questions?|open (?:'|‘)?(?:why|how)|\bask\b[^.;]{0,30}\bexplain why|how do you know|how did you (?:get|know)|\bask\b[^.;]{0,25}(?:'|‘|"|“)?\s*(?:why|how|what (?:do you think|would|if|made))|why do you think|کھلا سوال|کھلے سوال|(?:کیوں|کیسے)[^۔]{0,40}پوچھ|پوچھیں[^۔]{0,30}(?:کیوں|کیسے)/iu,
});

const ANSWER_FIRST = /\b(?:answers?|answered|says?|said|gives?|repl(?:y|ies)|responds?|names?|labels?|repeats?|echoes|explains?)\b|جواب دے|جواب [^،]{0,20}دے|کہے|بتائے|دہرائے/iu;
const REASONING = /(?:ask|have|let|get) (?:\w+ ){0,3}(?:to )?explain|explain (?:their|your) (?:thinking|reasoning|answer)|how do you know|how did you (?:get|know)|give (?:a|one) reason|\breasoning\b|وضاحت کریں|کیسے پتا|وجہ بتائیں/iu;
const OPEN_NAMED = /open[- ]ended|open questions?|کھلا سوال|کھلے سوال/iu;
const OPEN_WHY = /\bwhy\b|کیوں|what do you think|what would|what if|what (?:did|do) you (?:understand|notice|see)|تمہارے خیال|آپ کے خیال|اگر آپ|کیا سمجھ/iu;

/**
 * The why-family sub-ask: a named open question stays one; a "why" right after a child's answer is a follow-up; asking for
 * the reason is reasoning; else an open question. → move | null (an open question needs a real why / what-do-you-think:
 * 95-s1 shows that, not a procedure «how do you write …», panel r1 wrong).
 */
function questionMove(card, main) {
  const trigger = mask(card).slice(0, Math.max(0, card.length - main.length));
  if (FOLLOW_UP.test(main)) return 'follow_up_probe';
  if (!OPEN_NAMED.test(main) && ANSWER_FIRST.test(trigger) && WHY.test(main)) return 'follow_up_probe';
  if (!OPEN_NAMED.test(main) && REASONING.test(main)) return 'ask_for_reasoning';
  return OPEN_WHY.test(main) ? 'open_questions' : null;
}

// R9d route (a) (COS 20261119T215752; ped-align r9a 20261119T215415, 259/343 at #5202): a later visit is a pick for a
// teacher who has been shown a clip before (the r9a rank ≥ 2). There, only the card's MAIN step is served, and wait time
// only when the wait is that step with no question of the card's own («ask 'why…?', wait 5 s» is the question's card:
// r9a 451-s1 45/98). A near-miss anywhere on the card silences it (r9a: the TPS wrongs are a pair-share tacked onto
// feedback, a video, roles, a definition), except the pair-work words that ARE the think-pair-share ask.
const QUESTION_STEP = /\b(?:ask|asks|asking|pose)\b|open[- ]ended|\bwhy\b|\bhow\b|\?|؟|پوچھ|کیوں|کیسے|سوال/iu;
const LATER_NEAR_MISS_KEEP = Object.freeze({ think_pair_share: new Set(['pair_work', 'timed_pairs']) });
// …and three main steps the r9a wrongs name in Urdu (fitted on those 4 cards, later visits only): roles, a played video,
// a classmate's opinion of an answer
const LATER_NEAR_MISS = [
  ['roles', /\bرول\b|کا رول|کردار تقسیم/u],
  ['played_video', /\bvideo\b[^۔.]{0,15}چلائ|ویڈیو[^۔.]{0,15}چلائ/iu],
  ['peer_opinion', /جواب پر رائے/u],
];

/** A later visit (rank ≥ 2): the teacher has been shown a clip before. */
function laterVisit(history) {
  return !!history && ((history.segments || []).length > 0 || (history.modules || []).length > 0);
}

/**
 * The card's asks, in the order its main clause names them → [{ move, sub, at }] (empty = silence). One why-family ask at
 * most. The report asked every move named; a clip that shows any one of them, at its sub-ask, shows what was asked.
 * opts.later: a later visit (laterVisit), the main step only (above).
 */
function classifyAsks(sentence, opts = {}) {
  const asks = firstVisitAsks(sentence);
  if (!opts.later || !asks.length) return asks;
  const card = stripBidi(String(sentence || '')).replace(/\s+/g, ' ').trim();
  const main = asks[0];
  const keep = LATER_NEAR_MISS_KEEP[main.move] || new Set();
  if ([...NEAR_MISS, ...LATER_NEAR_MISS].some(([id, rx]) => !keep.has(id) && rx.test(card))) return [];
  if (main.move === 'wait_time' && QUESTION_STEP.test(mask(mainClause(card)).replace(/wait[- ]time/giu, ''))) return [];
  return [main];
}

function firstVisitAsks(sentence) {
  const card = stripBidi(String(sentence || '')).replace(/\s+/g, ' ').trim();
  const main = mainClause(card);
  if (!main) return [];
  const m = mask(main);
  const off = new Map();
  for (const [id, rx] of UNSHOWN) { const x = rx.exec(m) || rx.exec(main); if (x) off.set(id, x.index); }
  const only = new Set(REFUSE_ONLY.filter(([, rx]) => rx.test(main)).map(([id]) => id));
  const nearMiss = NEAR_MISS.some(([, rx]) => rx.test(card));
  if (NEAR_MISS[0][1].test(card)) return []; // a differentiated task anywhere: no clip shows it (ped-align's no-clip list)
  if (off.has('label')) return [];
  const found = [];
  for (const [id, rx] of Object.entries(ASK_RX)) {
    const x = rx.exec(main);
    if (!x) continue;
    const move = id === 'question' ? questionMove(card, main) : id;
    if (!move) continue;
    if (move === 'wait_time' && !QUESTION_NEAR.test(card)) continue;
    if ((REFUSE[move] || []).some((r) => off.has(r) || only.has(r))) continue;
    if (nearMiss && NEAR_MISS_FOR.has(move)) continue;
    if (NEAR_MISS_ONLY[move] && NEAR_MISS.some(([id, rx]) => NEAR_MISS_ONLY[move].has(id) && rx.test(card))) continue;
    found.push({ move, at: x.index });
  }
  if (!found.length) return [];
  const first = Math.min(...found.map((f) => f.at));
  if ([...off.values()].some((at) => at < first)) return []; // the card leads with a move no clip shows
  // the MAIN move decides (COS 152504 §2). A later ask is reached only past a questioning step (an open "why… then wait
  // time" card is one ask in two steps; ped-align r5: 790-s3 does not separate on the label there). After any other move
  // («ask what they already know, then wait time») the card is about that move, so nothing after it is served.
  const out = [];
  for (const f of found.sort((a, b) => a.at - b.at)) { out.push(f); if (!QUESTION_FAMILY.has(f.move)) break; }
  return out.map((f) => ({ ...f, sub: Object.keys(SUB_ASKS).find((k) => SUB_ASKS[k].move === f.move) })).filter((f) => f.sub);
}

/** The card's first ask (classifyAsks[0]) or null. */
function classifyAsk(sentence) {
  return classifyAsks(sentence)[0] || null;
}

// --- 2. the aligned chapters -------------------------------------------------------------------------------------------

const LIT = new Set(['urdu', 'english', 'literacy', 'reading']);
const BANDS = Object.freeze({ ece: [0, 0], '1-2': [1, 2], '1-3': [1, 3], '3-5': [3, 5], '4-5': [4, 5], '6-8': [6, 8], '9-12': [9, 12] });
const subj = (x) => {
  const s = String(x || '').trim().toLowerCase().replace(/\s+/g, '_');
  return { mathematics: 'maths', math: 'maths', islamiyat: 'islamiat', general_science: 'science', physics: 'science' }[s] || s;
};

/** ped-align bin/gates.py, as the panel paired cards with clips: the module's subjects. */
function subjectOk(module, lesson) {
  const cs = new Set((module.subjects || []).map(subj));
  if (!cs.size || cs.has('general')) return true;
  const ls = subj(lesson && lesson.subject);
  if (cs.has(ls)) return true;
  return LIT.has(ls) && [...cs].some((c) => LIT.has(c));
}

/** The module's grade band against the lesson's grade ({lo, hi} | null). */
function gradeOk(module, lesson) {
  const b = String(module.grade_band || 'all').toLowerCase();
  const g = lesson && lesson.grade && Number.isFinite(Number(lesson.grade.lo)) ? lesson.grade : null;
  if (!g || ['all', 'any', ''].includes(b)) return true;
  if (b === 'primary') return g.lo <= 5;
  const r = /^(\d{1,2})-(\d{1,2})$/.exec(b);
  const span = r ? [Number(r[1]), Number(r[2])] : BANDS[b];
  return span ? g.lo <= span[1] && g.hi >= span[0] : true;
}

/**
 * The moves whose cleared clips a teacher of another subject or grade can execute from, at the panel's bar (COS
 * 20261119T152504 §3; ped-align r5 cross-gate round: think_pair_share 80/80, follow_up_probe 40/40, 0 ⛔). Language
 * still binds. ask_for_reasoning (9/40), activate_prior_knowledge (25/40), inquiry_opening (3/10), open_questions and
 * attention_cue (too few pairs) keep the gate.
 */
// wait_time (39/40 = 97.5%) only together with the 790-s3 near-miss exclusion (NEAR_MISS above), as the COS ruled
const GATE_FREE = new Set(['think_pair_share', 'follow_up_probe', 'wait_time']);

/** lib's §B contract on one chapter (the shown move, not the moves it is about). */
function contractOk(module, seg, move) {
  const q = seg.quality || {};
  return module.recommendable !== false && seg.recommendable !== false && !module.dup_of && module.media_ok !== false
    && (seg.kind === 'demonstration' || seg.kind === 'modelled')
    && !!seg.shows && seg.shows.move === move
    && !!q.usable && Number.isFinite(Number(q.usable.start_s)) && Number(q.usable.end_s) > Number(q.usable.start_s)
    && q.sound !== 'poor';
}

/** A video's identity: its canonical copy (dup_of), else its video_id / module id. */
function videoKey(module) {
  return String(module.dup_of || module.video_id || `tm-${module.module_id}`);
}

/**
 * The chapters this card may get, best first: the 9 first clips before the second clips (SUB_ASK tier), then same
 * subject, then the narrower grade band, then seg id (stable).
 * @param {object} catalog  catalog.fromData(v2 data)
 * @param {{move, sub}} ask
 * @param {{languages:string[], history:{segments:string[], modules:number[]}, allow:Set<string>|null, later?:boolean}} ctx
 * @param {{subject:string|null, grade:{lo,hi}|null}} lesson
 */
function candidates(catalog, ask, ctx = {}, lesson = {}) {
  if (!catalog || !ask) return [];
  // the cross-gate (GATE_FREE) was judged on first clips; a later visit keeps the subject × grade gates (COS 215752)
  const later = ctx.later !== undefined ? !!ctx.later : laterVisit(ctx.history);
  const langs = new Set(ctx.languages || []);
  const h = ctx.history || {};
  const seenSegs = new Set((h.segments || []).map(String));
  // a video already shown: any chapter of it, or of a copy of the same file (also_in / dup_of)
  const seenVideos = new Set();
  for (const id of seenSegs) {
    const own = /^(\d+)-s\d+$/.exec(id); // a v1 chapter the v2 file does not carry still names its video
    if (own) seenVideos.add(`tm-${Number(own[1])}`);
    const hit = catalog.segment(id);
    if (!hit) continue;
    seenVideos.add(videoKey(hit.module));
    for (const v of hit.module.also_in || []) seenVideos.add(String(v));
  }
  for (const m of h.modules || []) seenVideos.add(`tm-${Number(m)}`);
  const out = [];
  for (const module of catalog.modules || []) {
    if (seenVideos.has(videoKey(module))) continue;
    if ((later || !GATE_FREE.has(ask.move)) && (!subjectOk(module, lesson) || !gradeOk(module, lesson))) continue;
    for (const seg of module.segments || []) {
      const rec = SUB_ASK[String(seg.seg_id)];
      if (!rec || rec.sub !== ask.sub) continue;
      if (ctx.allow && !ctx.allow.has(String(seg.seg_id))) continue;
      if (seenSegs.has(String(seg.seg_id))) continue;
      if (rec.grade_min && !(lesson && lesson.grade && Number(lesson.grade.lo) >= rec.grade_min)) continue; // unknown grade: no
      if (!contractOk(module, seg, ask.move)) continue;
      if (!langs.has(seg.language || module.language)) continue;
      out.push({ module, seg });
    }
  }
  const ls = subj(lesson && lesson.subject);
  const width = (m) => { const r = /^(\d{1,2})-(\d{1,2})$/.exec(String(m.grade_band || '')); return r ? Number(r[2]) - Number(r[1]) : 99; };
  const tier = (c) => SUB_ASK[String(c.seg.seg_id)].tier || 0;
  return out.sort((a, b) => tier(a) - tier(b) || Number((b.module.subjects || []).map(subj).includes(ls)) - Number((a.module.subjects || []).map(subj).includes(ls))
    || width(a.module) - width(b.module) || String(a.seg.seg_id).localeCompare(String(b.seg.seg_id)));
}

// --- 3. the reason line ------------------------------------------------------------------------------------------------

/** {reason_en, reason_ur}: what the report asked and what the clip shows (ux-strings videoRecoAlignedReason). */
function reasonFor(ask, seg) {
  const a = SUB_ASKS[ask && ask.sub];
  const rec = SUB_ASK[String(seg && seg.seg_id)];
  if (!a || !rec) return null;
  const n = Math.round(Number(seg.quality.usable.end_s) - Number(seg.quality.usable.start_s));
  const line = (l) => resolveUx('videoRecoAlignedReason', { language: l, params: { ask: a[`ask_${l}`], shows: rec[`shows_${l}`], n } });
  return { reason_en: line('en'), reason_ur: line('ur') };
}

module.exports = { GATE_FREE, laterVisit, classifyAsk, classifyAsks, mainClause, candidates, reasonFor, contractOk, videoKey, SUB_ASKS, SUB_ASK };
