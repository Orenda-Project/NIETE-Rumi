/**
 * Coaching Card Copy Configuration (i18n)
 *
 * Single source for all teacher-facing coaching-card copy: the card image
 * header/footer, the focus-area message, and the commit-prompt buttons.
 * Previously this copy was English-only and scattered across
 * card-image.service.js and report-generator.service.js.
 *
 * Keyed by language code. Languages mirror those supported in
 * language-config.js (en, ur, ar, es). English (en) is the seed and the
 * fallback; its wording is byte-identical to the prior hardcoded strings
 * so existing behavior is preserved.
 *
 * Placeholders use {token} and are filled by the caller:
 *   focusAreaMessage: {action}, {example}
 */

const COACHING_CARD_COPY = {
  // English (seed + fallback) — wording preserved from prior hardcoded copy.
  en: {
    cardHeader: '🎯 Try This Next Class',
    cardFooter: 'Rumi Digital Coach',
    focusAreaTitle: 'Your Focus Area',
    focusAreaMessage: '🎯 *Your Focus Area*\n\n{action}\n\n💡 _{example}_',
    commitPrompt: 'Will you commit to trying this in your next class?',
    commitButtons: {
      yes: "Yes, I'll try!",
      later: 'Maybe later',
      no: 'Not for me',
    },
  },

  // Urdu
  ur: {
    cardHeader: '🎯 اگلی کلاس میں یہ آزمائیں',
    cardFooter: 'Rumi Digital Coach',
    focusAreaTitle: 'آپ کی توجہ کا شعبہ',
    focusAreaMessage: '🎯 *آپ کی توجہ کا شعبہ*\n\n{action}\n\n💡 _{example}_',
    commitPrompt: 'کیا آپ اگلی کلاس میں یہ آزمانے کا عہد کریں گے؟',
    commitButtons: {
      yes: 'جی ہاں، میں کوشش کروں گا!',
      later: 'شاید بعد میں',
      no: 'میرے لیے نہیں',
    },
  },

  // Arabic
  ar: {
    cardHeader: '🎯 جرّب هذا في الحصة القادمة',
    cardFooter: 'Rumi Digital Coach',
    focusAreaTitle: 'مجال تركيزك',
    focusAreaMessage: '🎯 *مجال تركيزك*\n\n{action}\n\n💡 _{example}_',
    commitPrompt: 'هل تلتزم بتجربة هذا في حصتك القادمة؟',
    commitButtons: {
      yes: 'نعم، سأحاول!',
      later: 'ربما لاحقًا',
      no: 'ليس لي',
    },
  },

  // Spanish
  es: {
    cardHeader: '🎯 Prueba esto en tu próxima clase',
    cardFooter: 'Rumi Digital Coach',
    focusAreaTitle: 'Tu área de enfoque',
    focusAreaMessage: '🎯 *Tu área de enfoque*\n\n{action}\n\n💡 _{example}_',
    commitPrompt: '¿Te comprometes a probar esto en tu próxima clase?',
    commitButtons: {
      yes: '¡Sí, lo intentaré!',
      later: 'Quizás más tarde',
      no: 'No es para mí',
    },
  },
};

const DEFAULT_CARD_LANGUAGE = 'en';

/**
 * Get the coaching-card copy for a language, falling back to English.
 * @param {string} [language='en'] - Language code (en, ur, ar, es)
 * @returns {object} Copy block for the language
 */
function getCoachingCardCopy(language = DEFAULT_CARD_LANGUAGE) {
  return COACHING_CARD_COPY[language] || COACHING_CARD_COPY[DEFAULT_CARD_LANGUAGE];
}

module.exports = {
  COACHING_CARD_COPY,
  DEFAULT_CARD_LANGUAGE,
  getCoachingCardCopy,
};
