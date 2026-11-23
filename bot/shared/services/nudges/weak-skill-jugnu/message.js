'use strict';
/**
 * bd-ptl6x9.7 — a picked skill → the template call whatsapp.service.sendTemplate makes. Pure.
 * Language is the teacher's preferred_language, clamped to the NIETE offer (en/ur, English floor). The message carries
 * the grade and words only: never a count, a rate or a child's name.
 */

const { clampLanguage, UX_STRINGS } = require('../../../config/ux-strings');
const { templateCodeFor } = require('../../../config/languages');
const { TEMPLATE, WORDS } = require('../../../templates/weak-skill-jugnu.template');

const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d)));
/** How a number is written in each language's message: Urdu digits on the Urdu one. */
const DIGITS = { en: String, ur: urDigits };
const text = (v) => ({ type: 'text', text: String(v) });

function firstName(name, lang) {
  const first = String(name || '').trim().split(/\s+/)[0];
  const none = UX_STRINGS.weakSkillJugnuNoName;
  return first || none[lang] || none.en;
}

/**
 * @param {{picked:{game:string}, grade:number, token:string, listId:string, teacher:object}} args
 * @returns {null|{template:string, languageCode:string, language:string, game:string, components:Array}}
 */
function buildMessage({ picked, grade, token, listId, teacher = {} } = {}) {
  const game = picked && picked.game;
  if (!WORDS[game] || !token || !listId || !grade) return null;
  const language = clampLanguage(teacher.preferred_language);
  const w = WORDS[game][language] || WORDS[game].en;
  const suffix = `${token}/sfwd?class=${encodeURIComponent(listId)}&ex=${game}&lang=${language}`;
  return {
    template: TEMPLATE.name,
    languageCode: templateCodeFor(language),
    language,
    game,
    components: [
      { type: 'body', parameters: [firstName(teacher.name, language), (DIGITS[language] || String)(grade), w.skill, w.game].map(text) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [text(suffix)] },
    ],
  };
}

module.exports = { buildMessage };
