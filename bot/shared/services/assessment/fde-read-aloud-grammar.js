'use strict';
/**
 * A grammar slip on a read-aloud card (round 6 blocker, bd-5jmnfj.4.58.9.2). v35 G2 English card 3 printed
 * «Pinky eyes were sparkling.»: the possessive 's was lost. The teacher reads the card word for word, so the slip
 * reaches the child as a model of English.
 *   mendText        a name followed by a body or family noun and a verb takes the 's (Pinky eyes were → Pinky's
 *                   eyes were); a doubled word collapses (the the → the), never one English doubles (had had).
 *   slipsOf         an agreement slip (she were, they was) is reported, not guessed at: the fix depends on meaning.
 *   mendReadAloud   applies both to the oral sheet's script and every item's ask and answer.
 * English only: an Urdu card is left alone. Pure: never throws, never mutates its input.
 */

const NOUNS = 'eyes|eye|hands|hand|ears|ear|hair|face|feet|foot|nose|mouth|head|legs|leg|arms|arm|voice|smile|cheeks|teeth|'
  + 'bag|book|books|shoes|shoe|hat|cap|dress|shirt|kite|ball|bike|cat|dog|pet|toy|toys|house|home|room|desk|lunch|'
  + 'mother|father|mama|baba|brother|sister|friend|friends|teacher|grandmother|grandfather|family|uncle|aunt';
const VERBS = 'were|was|are|is|had|has|have|looked|look|felt|shone|sparkled|shined|filled|lit|grew|went|became';
const NOT_NAMES = new Set(['The', 'A', 'An', 'His', 'Her', 'Their', 'Our', 'My', 'Your', 'Its', 'This', 'That', 'These',
  'Those', 'Some', 'All', 'Both', 'Each', 'Every', 'Two', 'Three', 'Many', 'Few', 'No', 'Then', 'When', 'And', 'But',
  'So', 'Now', 'Her', 'Whose', 'Which', 'What', 'Where', 'How', 'Why', 'Who', 'If', 'Sir', 'Madam', 'Miss', 'Mr', 'Mrs']);
const POSSESSIVE = new RegExp(`\\b([A-Z][a-z]+)\\s+(${NOUNS})\\s+(${VERBS})\\b`, 'g');
const DOUBLED = /\b([A-Za-z]+)\s+\1\b/g;
const DOUBLE_OK = new Set(['had', 'that', 'is', 'very', 'bye', 'no', 'ha', 'knock', 'tick', 'tock', 'yes', 'so', 'now', 'come', 'go', 'run']);
const AGREEMENT = [
  /\b(he|she|it)\s+(were|are|have)\b/gi,
  /\b(they|we|you)\s+(was|is|has)\b/gi,
  /\b(I)\s+(is|are|has)\b/g,
];
const SUBJUNCTIVE = /\b(if|wish|as though|as if)\s+$/i;

const isEnglish = (s) => typeof s === 'string' && /[a-z]/i.test(s) && !/[؀-ۿ]/.test(s);

function mendText(text) {
  if (!isEnglish(text)) return { text, notes: [] };
  const notes = [];
  let out = text.replace(POSSESSIVE, (all, name, noun, verb) => {
    if (NOT_NAMES.has(name)) return all;
    notes.push(`«${all}» → «${name}'s ${noun} ${verb}»`);
    return `${name}'s ${noun} ${verb}`;
  });
  out = out.replace(DOUBLED, (all, w) => {
    if (DOUBLE_OK.has(w.toLowerCase())) return all;
    notes.push(`«${all}» → «${w}»`);
    return w;
  });
  return { text: out, notes };
}

function slipsOf(text) {
  if (!isEnglish(text)) return [];
  const out = [];
  AGREEMENT.forEach((re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (/were/i.test(m[2]) && SUBJUNCTIVE.test(text.slice(0, m.index))) continue;
      out.push(`agreement slip «${m[0]}» in «${text.trim().slice(0, 120)}»`);
    }
  });
  return out;
}

function mendReadAloud(examJson) {
  const notes = [];
  try {
    const content = examJson && examJson._layout && examJson._layout.oral && examJson._layout.oral.content;
    if (!Array.isArray(content)) return { examJson, notes };
    let changed = false;
    const fix = (s) => {
      if (typeof s !== 'string') return s;
      const m = mendText(s);
      notes.push(...m.notes, ...slipsOf(m.text));
      if (m.text !== s) changed = true;
      return m.text;
    };
    const next = content.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const card = { ...c };
      if (typeof c.script === 'string') card.script = fix(c.script);
      if (Array.isArray(c.items)) card.items = c.items.map((it) => (it && typeof it === 'object' ? { ...it, ask: fix(it.ask), answer: fix(it.answer) } : it));
      return card;
    });
    if (!changed) return { examJson, notes };
    return { examJson: { ...examJson, _layout: { ...examJson._layout, oral: { ...examJson._layout.oral, content: next } } }, notes };
  } catch (e) {
    return { examJson, notes: [] };
  }
}

module.exports = { mendText, slipsOf, mendReadAloud };
