'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const { ONE_FIT_RULE, alternativeShortfall, acceptAlternatives } = require('../fde-accept-alternatives'); // two right answers, one keyed (bd-5jmnfj.4.58.9.1)
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { MATHS_RECALL_FROM, MATHS_RECALL_TO, SST_Q1, SST_RECALL_FROM, SST_RECALL_TO, SST_TIER_NAMED, _closedLists, _holdsTierTable, _slotBlock } = require('./held-terms');
const { ENGLISH_FDE_Q1A_ANAGRAMS, ENGLISH_PAGES_SLOTS, MATHS_PAGES_SLOTS, MATHS_Q1B_WORDS, RULE, URDU_LESSONS_Q1, URDU_LESSONS_RULES } = require('./pattern-rules');
const { TOS } = require('./section-calls');

/**
 * What one section of a board-pattern paper asks for. The book text block is
 * the same as buildUserPrompt's (which stays untouched for every other paper);
 * after it, the section's slots and the rules that apply to this subject and
 * this section. Every pattern-specific word comes from the pattern data.
 */
function buildPatternUserPrompt({ grade, subject, pageContent, pageReference, section, slots, lang, P, scope, poem = null }) {
  const medium = lang || P.medium;
  const key = P.key || Patterns.normalise(subject);
  const sectionLabel = section.label_en || section.label_ur || section.id;

  // The FDE syllabus names units and kinds per slot; a paper set on chosen chapters or
  // pages keeps each slot's kind and marks but takes its items from those pages only.
  const fde = Boolean(scope) && scope.kind === 'fde';
  // Maths Section C on chosen pages: the fixed one-of-each-kind list (draw, area, …) is
  // FDE's Units 11–12 syllabus, so it is not asked for; marks and shape stay.
  const mathsC = !fde && key === 'maths' && section.id === 'C';
  const urduLessons = !fde && key === 'urdu' ? scopeLessons(P, scope) : null;
  // Their grammar concepts, less the kinds Q4 asks.
  const urduTerms = urduLessons && [...new Set(urduLessons.flatMap((l) => l.grammar.filter((g) => !g.q4).map((g) => g.ur)))];
  // How many concepts those are: an entry the layout reads as two (تمنائی اور شکیہ) counts two.
  const urduWidth = (ur) => Math.max(1, ...urduLessons.flatMap((l) => l.grammar).filter((g) => g.ur === ur).map((g) => (g.tags || []).length));
  const urduPairs = urduTerms && urduTerms.filter((ur) => urduWidth(ur) > 1);
  const urduConcepts = urduTerms && urduTerms.reduce((n, ur) => n + urduWidth(ur), 0);
  // A slot the teacher writes (Islamiat Q3, bd-5jmnfj.39.1) is never asked of the model.
  const given = (Array.isArray(slots) && slots.length ? slots : section.slots).filter((s) => !s.teacher_fills);
  const shaped = given.map((s) => {
    if (mathsC && Array.isArray(s.kinds) && s.kinds.length) {
      return { ...s, kinds: null, prompt_rule: null, grain: s.grain && { ...s.grain, kind: 'a word problem or a calculation' } };
    }
    // Maths on chosen pages: Q1(b)'s ten model topics and Q2's Units 1–8 families go; the topics come from the pages.
    const mathsSlot = !fde && key === 'maths' && MATHS_PAGES_SLOTS[s.slot];
    if (mathsSlot && typeof s.prompt_rule === 'string') {
      const at = s.prompt_rule.indexOf(mathsSlot.keepFrom);
      return {
        ...s,
        prompt_rule: mathsSlot.head + (at >= 0 ? s.prompt_rule.slice(at) : ''),
        grain: s.grain && {
          ...s.grain,
          kind: typeof s.grain.kind === 'string' ? s.grain.kind.split(/[,:]/)[0] : s.grain.kind,
          number_size: mathsSlot.number_size,
        },
        families: null,
      };
    }
    // Urdu on chosen lessons: Q1's grammar is those lessons' own, never "half grammar" from lessons 4–10.
    if (urduLessons && s.slot === 'urdu.A.Q1' && typeof s.prompt_rule === 'string') {
      const at = s.prompt_rule.indexOf(URDU_LESSONS_Q1.keepFrom);
      return {
        ...s,
        prompt_rule: URDU_LESSONS_Q1.rule(urduTerms) + (at >= 0 ? s.prompt_rule.slice(at) : ''),
        grain: s.grain && { ...s.grain, kind: URDU_LESSONS_Q1.kind(urduTerms) },
      };
    }
    // English on chosen pages: the slot's FDE topic list goes; the points come from the pages.
    const pagesSlot = !fde && key === 'english' && ENGLISH_PAGES_SLOTS[s.slot];
    if (pagesSlot) {
      return {
        ...s,
        prompt_rule: pagesSlot.prompt_rule,
        grain: pagesSlot.grain_kind && s.grain ? { ...s.grain, kind: pagesSlot.grain_kind } : s.grain,
      };
    }
    if (key === 'english' && s.slot === 'english.A.Q1a' && typeof s.prompt_rule === 'string') {
      return { ...s, prompt_rule: s.prompt_rule.replace(ENGLISH_FDE_Q1A_ANAGRAMS, '') };
    }
    // Maths MCQs: the ToS floor's recall count replaces the slot's 3-to-5.
    if (key === 'maths' && typeof s.prompt_rule === 'string' && s.prompt_rule.includes(MATHS_RECALL_FROM)) {
      return { ...s, prompt_rule: s.prompt_rule.replace(MATHS_RECALL_FROM, MATHS_RECALL_TO) };
    }
    if (key === 'social_studies' && s.slot === SST_Q1 && typeof s.prompt_rule === 'string' && s.prompt_rule.includes(SST_RECALL_FROM)) {
      return { ...s, prompt_rule: s.prompt_rule.replace(SST_RECALL_FROM, SST_RECALL_TO) };
    }
    return s;
  });
  const list = shaped.map((s) => (key === 'english' && s.slot === 'english.A.Q1b'
    ? { ...s, prompt_rule: [s.prompt_rule, RULE.q1bQuote, RULE.q1bOne].filter(Boolean).join(' ') }
    : s));
  // English Q5 on chosen pages that hold no poem: the nearest poem's page text, when the caller loaded it.
  const givenPoem = !fde && key === 'english' && poem && poem.content && list.some((s) => s.slot === 'english.C.Q5') ? poem : null;
  // Urdu Q6 on lessons that hold no poem: lesson 7's poem page text, when the caller loaded it.
  const urduPoem = !fde && key === 'urdu' && poem && poem.content && list.some((s) => s.slot === 'urdu.C.Q6') ? poem : null;
  const hasMcq = list.some((s) => s.shape === 'mcq');
  const rules = [RULE.bookOnly, RULE.religious];
  if (key === 'social_studies') rules.push(RULE.sstPremise);
  if (!fde) rules.push(RULE.chapterOnly);
  if (mathsC) rules.push(RULE.mathsSectionC);
  if (!fde && key === 'english' && hasMcq) rules.push(RULE.grammarFromPages);
  if (!fde && key === 'english' && list.some((s) => ENGLISH_PAGES_SLOTS[s.slot])) rules.push(RULE.pagesPoints, RULE.pagesRest);
  if (!fde && key === 'english' && list.some((s) => s.slot === 'english.C.Q5')) rules.push(givenPoem ? RULE.q5Given(givenPoem) : RULE.q5Poem);
  if (key === 'english') rules.push(RULE.noAnagram);
  if (key === 'science' && list.some((s) => s.shape === 'situation')) {
    rules.push('Science: a situation comes only from the book activities its slot\'s rule lists, never another.');
  }
  const closed = _closedLists(P, list);
  if (closed) rules.push(closed);
  // Grade 3–4 mid patterns carry g5_rules: false and skip the Grade-5-only lines below (bd-5jmnfj.33.1).
  const g5Rules = P.g5_rules !== false;
  if (key === 'urdu' && g5Rules) rules.push(fde ? `${RULE.held} Set items only from book pages ${P.scope.page_ranges}.` : RULE.held);
  if (key === 'urdu') rules.push(RULE.urduNoMaxims);
  if (key === 'urdu' && list.some((s) => /^urdu\.[AC]\./.test(s.slot))) rules.push(RULE.urduNoDates);
  if (urduPoem) rules.push(RULE.urduQ6Given(urduPoem));
  if (scope && scope.kind === 'fde' && P.scope.excluded_pages_note) rules.push(P.scope.excluded_pages_note);
  const tos = P.tos || TOS[key];
  if (tos) {
    const split = Object.entries(tos).map(([band, pct]) => `${band} ${pct}%`).join(', ');
    rules.push(`Across the whole paper the marks split by thinking level is ${split} (FDE's table of specification). `
      + `Tag each item: ${RULE.r1}${key === 'english' ? `; ${RULE.r1English}` : ''}.`);
  }
  // Each section is its own call: told only the paper's split, every section tried to carry it alone (bd-5jmnfj.19).
  if (section && section.levels) {
    const own = Object.entries(section.levels).map(([band, marks]) => `${band} ${marks}`).join(', ');
    rules.push(`This section's ${section.marks} marks split by thinking level as ${own}. Tag this section's items to match it.`);
  }
  if (key === 'urdu' && list.some((s) => /^urdu\.C\.Q(7|8|9|10)$/.test(s.slot))) rules.push(RULE.urduWritingApply);
  if (key === 'urdu' && list.some((s) => /^urdu\.C\.Q(4|5)$/.test(s.slot))) rules.push(RULE.urduSentenceUnderstand);
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.C.Q6')) rules.push(RULE.urduPoemRemember);
  if (key === 'maths') rules.push(...(g5Rules ? [RULE.mathsTosFloor] : []), RULE.unitsNumerals);
  if (key === 'maths') {
    const q1b = list.find((s) => s.slot === 'maths.A.Q1b');
    if (q1b) rules.push(RULE.mathsQ1bWords(Math.min(MATHS_Q1B_WORDS, q1b.generate), q1b.generate));
    const q2 = list.find((s) => s.slot === 'maths.B.Q2');
    if (q2) {
      // One above half: the model lands one or two short of a counted rule.
      const need = Math.ceil(q2.generate / 2) + 1;
      rules.push(RULE.mathsQ2Words(need, q2.generate));
      // FDE's families carry one word problem each; the rest of the count comes from their other items.
      // The families are FDE's syllabus, so on chosen pages they are not asked for (see MATHS_PAGES_SLOTS).
      const extra = fde && Array.isArray(q2.families) ? need - q2.families.length : 0;
      if (extra > 0) rules.push(RULE.mathsQ2Families(extra));
    }
    if (!fde && list.some((s) => MATHS_PAGES_SLOTS[s.slot])) rules.push(RULE.mathsPagesAB);
  }
  if (!g5Rules) {
    rules.push(`Use Grade ${P.grade} vocabulary; a term the book does not use is replaced by the book's word.`);
    // v30 G3 Maths Q5: accept carried the wording the common error called wrong; a three-thing ask keyed one point (bd-5jmnfj.33.2).
    rules.push('`accept` never lists a wording the same item\'s common_error names as wrong; an item that asks for N things keys N points.');
    // v31 (bd-5jmnfj.33.3): a vacuum asked twice, keys printed in later stems, checks paid unasked, a part labelled "Q5.".
    rules.push('No two items ask the same question or test the same fact; a stem never prints another item\'s answer or target word.');
    rules.push('A model answer states only what the chapter text states; a check is paid only where the stem asks for one and uses a different method; an item never carries its own question number or label.');
    // v36 (bd-5jmnfj.33.7.2): keys paid the stem's own words, one fact twice, or past the asked end point.
    rules.push('Each marking point pays a different idea the stem asks for: never the stem\'s own words, never one idea twice, never an idea past what the stem asks (where the stem stops, the answer stops). A stem that asks for any example keys any example the chapter supports, and a common_error never names a correct case.');
    // v38 round-6 panel (bd-5jmnfj.33.7.1): number sentences, units, greetings and reasons paid where the stem never asked.
    rules.push('A unit, a number sentence, a complete sentence, a greeting or closing, or a reason earns a mark only when the stem or instruction asks for it in words.');
    rules.push('One stem asks one thing. An MCQ\'s options are all different strings. A chapter word is tested in one item only (a meaning, a spelling, a sentence or a question, never two of these), and an MCQ key, a blank sentence or a match pair is never the marking point of a written item.');
  } else if (key === 'science' || key === 'english') rules.push(RULE.grade5Words);
  if (hasMcq) {
    if (key !== 'maths' && key !== 'social_studies') rules.push(`In this section, ${RULE.recall}.`);
    rules.push(RULE.spreadKeys, RULE.oneCorrect, RULE.optionsOnly);
    // Word MCQs (anagram, homophone, spelling) on the language papers; number options on Maths and Science.
    if (key === 'english') rules.push(RULE.oneKeyEnglish);
    if (key === 'urdu') rules.push(RULE.oneKey, RULE.urduSpelling, RULE.oneQuestion, RULE.urduPlainOptions);
    if (key === 'urdu' && list.some((s) => s.slot === 'urdu.A.Q1')) {
      const q1 = list.find((s) => s.slot === 'urdu.A.Q1');
      const concepts = urduTerms
        ? [URDU_LESSONS_RULES.conceptOnce(urduTerms), URDU_LESSONS_RULES.termWord(urduTerms),
          URDU_LESSONS_RULES.budget(urduTerms, urduConcepts, q1.generate, urduPairs), URDU_LESSONS_RULES.concept(urduTerms)].filter(Boolean)
        : [RULE.urduConceptOnce, RULE.urduTermWord];
      rules.push(...concepts, RULE.urduHomograph, RULE.urduVerbSense, RULE.urduPunctuation, RULE.urduFormFamily, RULE.urduOneTable);
      if (urduLessons && oneStory(urduLessons)) rules.push(URDU_LESSONS_RULES.story(q1.generate));
    }
    if (key === 'maths' || key === 'science') rules.push(RULE.unequalOptions);
    if (key === 'maths') rules.push(RULE.propertyOneKey);
  }
  // A section with a picture-description frame (G5 Urdu Q7, English Q10) gets a drawn scene (v24 review).
  const framePicture = list.some((s) => s.frame && s.frame.kind === 'picture');
  rules.push(framePicture ? RULE.framePictures : RULE.noPictures, RULE.marks, RULE.blooms, RULE.scheme, RULE.accept, ONE_FIT_RULE);
  if (fde && key === 'maths' && list.some((s) => (Array.isArray(s.families) && s.families.length) || (Array.isArray(s.kinds) && s.kinds.length))) {
    rules.push(RULE.families);
  }
  rules.push(RULE.table);
  const picks = list.some((s) => Array.isArray(s.parts_spec) && s.parts_spec.some((p) => p.pick));
  if (picks && medium === 'ur') rules.push(RULE.picks);
  if (picks) rules.push(RULE.picksVerbatim);
  if ((key === 'science' || key === 'social_studies') && list.some((s) => s.shape === 'frame')) rules.push(RULE.frameLabels);
  if (key === 'science' && list.some((s) => s.shape === 'situation')) rules.push(RULE.situationParts);
  if (key === 'science' && list.some((s) => /\.Q3[a-z]?$/.test(s.slot))) rules.push(RULE.scienceQ3);
  if (key === 'urdu') rules.push(RULE.urduSchemeText);
  if (key === 'urdu' && list.some((s) => /\.Q4$/.test(s.slot))) rules.push(RULE.urduQ4, RULE.urduQ4Group, RULE.urduQ4GroupNotListed, RULE.urduQ4Syllables);
  // The book's own worked splits, quoted as the book prints them.
  if (key === 'urdu' && Array.isArray(P.syllables) && P.syllables.length && list.some((s) => /\.Q4$/.test(s.slot))) {
    const said = P.syllables.map((b) => `«${b.word}» as ${b.parts.join(' – ')}`);
    rules.push(`The book splits ${said.slice(0, -1).join(', ')}${said.length > 1 ? ' and ' : ''}${said[said.length - 1]}.`);
  }
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.C.Q3') && list.some((s) => s.slot === 'urdu.C.Q5')) rules.push(RULE.urduOneWordOnePlace);
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.C.Q6')) rules.push(RULE.urduQ6Points);
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.B.Q2')) rules.push(RULE.urduRelationNouns);
  rules.push(RULE.scaffold, RULE.noTags, RULE.noUnderline, RULE.gender, RULE.people);
  rules.push(medium === 'ur' ? RULE.genderUrdu : RULE.namedChild);
  rules.push(RULE.noRepeats);
  if (key === 'social_studies' && list.some((s) => /\.Q[57]$/.test(s.slot))) rules.push(RULE.sstNoReask);
  if (key === 'social_studies') {
    const bands = list.map((s) => RULE.sstBand[s.slot.split('.').pop()]).filter(Boolean);
    if (bands.length) rules.push(...bands, RULE.sstGroups);
    if (list.some((s) => s.slot === SST_Q1)) rules.push(RULE.sstQ1Levels);
    if (list.some((s) => /\.[CD]\./.test(s.slot))) rules.push(RULE.sstFactPoints);
  }
  if (key === 'social_studies') {
    const inPages = _holdsTierTable(pageContent);
    if (inPages || SST_TIER_NAMED.test(String(pageContent || ''))) rules.push(RULE.sstTiers(inPages));
  }

  return `**Grade:** ${grade}
**Subject:** ${subject}
**Page Reference:** ${pageReference}

**Book Text Content:**
\`\`\`
${pageContent}
\`\`\`
${givenPoem ? `
**Poem for Q5 (book p.${givenPoem.pages}):**
\`\`\`
${givenPoem.content}
\`\`\`
` : ''}${urduPoem ? `
**Poem for Q6 (book pp. ${urduPoem.pages}):**
\`\`\`
${urduPoem.content}
\`\`\`
` : ''}
**SECTION ${section.id}** — ${sectionLabel}, one section of a board-pattern paper. Write this section only.

**GENERATE THE FOLLOWING:**
${list.map((slot) => _slotBlock(slot, medium)).join('\n')}

Put the items in the tree: unseen → objective|subjective → "<type>" → [items], every item tagged with its "slot".

**RULES:**
${rules.map((r) => `• ${r}`).join('\n')}

${RULE.jsonOnly}
`;
}

/** "=== Page N ===" blocks, in order; null when the text carries no markers. */
function _splitPages(content) {
  const text = String(content || '');
  const marks = [...text.matchAll(/=== Page (\d+) ===\n?/g)];
  if (!marks.length) return null;
  return marks.map((m, i) => ({
    page: Number(m[1]),
    text: text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length).trim(),
  }));
}

// The slot each subject's given poem is for: English Q5, Urdu Q6's verses.
const POEM_SLOT = { english: 'english.C.Q5', urdu: 'urdu.C.Q6' };

module.exports = {
  POEM_SLOT, _splitPages, buildPatternUserPrompt,
};
