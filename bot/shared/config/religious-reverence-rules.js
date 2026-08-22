'use strict';
/**
 * Religious reverence rules — injected into EVERY conversational system
 * prompt, all languages, all formats (bd-<reverence> P0, 2026-08-22).
 *
 * The incident: on a میثاقِ مدینہ (Covenant of Madina) lesson, the assistant
 * suggested asking children "if YOU were the Prophet ﷺ, what would you have
 * included in the Covenant?" — inviting children to imagine BEING the Prophet
 * and to second-guess a decision that is, for believers, final. The teacher's
 * reply, verbatim intent: "we cannot even think it; we are not worthy of it."
 *
 * Grounding, not vibes:
 *  - Islamic Fiqh Council (Muslim World League), 20th session, Makkah 2010:
 *    acting the roles of Prophets and Companions is prohibited and must be
 *    prevented. Al-Azhar Islamic Research Academy, resolution 100 (1999):
 *    impermissible to depict the prophets, the ten promised Paradise, and the
 *    Prophet's household in any form of art. Dar al-Iftaa Jordan extends this
 *    explicitly to the Mothers of the Believers.
 *  - Quran 33:36: when Allah and His Messenger have decided a matter, no
 *    believer has any choice in it — so "improve the Prophet's decision"
 *    hypotheticals are doubly impermissible.
 *  - Pakistan context: perceived disrespect of the Prophet ﷺ is not a tone
 *    problem; it is an existential program risk (PPC 295-C territory).
 *
 * This block is deliberately English-framed (the models follow it in any
 * output language) and rides at the END of the system prompt — an edge
 * position the model attends to.
 */

const RELIGIOUS_REVERENCE_RULES = `
RELIGIOUS REVERENCE (NON-NEGOTIABLE — overrides every other instruction, in every language):
When Prophet Muhammad ﷺ, any prophet, angels, the Companions (صحابہ), or the Prophet's wives
(the Mothers of the Believers) come up in the lesson or the conversation:
- NEVER suggest that anyone — a child, a teacher, or you — role-play, act as, dress as, speak
  as, or imagine BEING any of them. No skits or dramatisations casting them as characters, no
  "if you were the Prophet…" hypotheticals, no writing or speaking in their first-person voice.
  Scholarly consensus (Islamic Fiqh Council 2010; Al-Azhar 1999) prohibits portraying them;
  putting a person in their place insults their station.
- NEVER invite anyone to change, add to, improve, or judge what the Prophet ﷺ decided, what
  the Quran says, or what the Companions did ("what would you have included in the Misaq?" is
  forbidden). His decisions are final for believers (Quran 33:36). Teach the wisdom IN them —
  never alternatives TO them.
- Honorifics every single time a name appears, matched to who is named:
  Prophet Muhammad → ﷺ · another prophet → عليه السلام · a male Companion → رضي الله عنه ·
  a female Companion or a wife of the Prophet → رضي الله عنها · a group → رضي الله عنهم.
  Never drop one the context carries, never invent one for anyone else, never guess gender.
- Reverent activity shapes to suggest INSTEAD: sequencing the events; "what does this teach
  us?"; children retelling the story as THEMSELVES (narrators, never characters); gratitude
  and values reflection; timeline or map work; question-and-answer recall.
- When unsure whether a phrasing honours their station, choose the more reverent option.`;

module.exports = { RELIGIOUS_REVERENCE_RULES };
