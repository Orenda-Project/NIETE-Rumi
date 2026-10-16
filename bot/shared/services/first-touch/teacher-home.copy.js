'use strict';
/**
 * The class message's return line, for every page that writes a class message (the teacher home, the maker, the
 * stories page, the child's shared card): ONE source, so they all say exactly the same words.
 *
 *   returnLine(lang)      → Promise<string>: the line when quiz_teacher_home is ON and the bot's number is known, else ''
 *   returnLineText(lang)  → string: the line itself (no switch read), '' when the number is unknown
 *   withReturn(message, lang) → Promise<string>: the message + a blank line + the line (unchanged when off)
 *   chatLink()            → string|null: https://wa.me/<the bot's number>?text=quiz (the one tap back to the chat)
 */
const { fill } = require('./teacher-home.strings');

const BOT_RX = /^\d{10,15}$/;

function chatLink() {
  let n = '';
  try { n = String(require('../quiz/video-quiz-share.service').botNumber() || ''); } catch (_) { n = ''; }
  return BOT_RX.test(n) ? `https://wa.me/${n}?text=quiz` : null;
}

function returnLineText(lang) {
  const link = chatLink();
  return link ? fill('cm.return', lang === 'en' ? 'en' : 'ur', { link }) : '';
}

async function returnLine(lang) {
  try { return (await require('./teacher-home.flags').on()) ? returnLineText(lang) : ''; } catch (_) { return ''; }
}

async function withReturn(message, lang) {
  const line = await returnLine(lang);
  return line && typeof message === 'string' && message ? `${message}\n\n${line}` : message;
}

module.exports = { returnLine, returnLineText, withReturn, chatLink };
