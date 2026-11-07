/**
 * Constants and patterns of the v10 card content gates (port of the top half of workbench/card/card_rules.py).
 * Python's \b and \w are Unicode-aware, so word boundaries here use pytext's BS/BE/WB (Urdu letters are word
 * characters; the Urdu word for "join" must not match the word for "pair").
 */
const { BS, BE, WB } = require('./pytext');

const ORDER = ['open', 'explain', 'we', 'you', 'check', 'hw'];
const CORE = ORDER.slice(0, 5);
const TOTAL = 40;
const MAX_MOVES = 8;
const NEIGHBOUR = 'ONE NEIGHBOUR TURN';
// characters of visible text, so the card prints on one 520 x 2000 page
const CAPS = { do: 70, how: 120, say: 90, think: 140, yesterday: 90 };
const MISTAKE_CAP = 150;
const SUCCESS_CAP = 80;
const CHECK_CAPS = { ask: 90, listen: 110 };
const STUCK_CAP = 110;
const TURN_CAPS = { first: 20, a: 70, b: 70, stop: 40 };
const HELP_CAP = 45; // judge 9G: a fixed repair phrase for a stuck child, English turns only
const PIC_KINDS = ['faces', 'steps', 'svg'];

const rx = (src, flags = 'iu') => new RegExp(src, flags);
const PENDING = rx('design pending|PENDING');
const SLATE = rx(`${WB}slates?${WB}`);
// pair words that name lesson content, taken out before the pair-talk check
const CONTENT_PAIRS = rx(`${WB}rhyming pairs?${WB}|${WB}neighbou?r numbers?${WB}`, 'giu');
const HOME = rx(`${WB}(homes?|houses?|family|families|mohalla|streets?|bazaar|markets?|shops?|kitchen|village|`
  + `neighbourhood|mosque|park|Dadi|Nani|Ammi|Abbu)${WB}|گھر|محلے|محلہ|بازار|دکان`);
const ANSWERED = rx('\\?\\s*\\([^)]+\\)[^\\p{L}\\p{N}_]*$');
// pair talk words, English and Urdu (ساتھی partner, جوڑی pair, پڑوسی neighbour); جوڑی is whole-word so جوڑیں (join) passes
const PAIR = rx(`${WB}(budd(y|ies)|partners?|pairs?|neighbou?rs?|turn to)${WB}|ساتھی|جوڑی(?:اں|وں)?${BE}|پڑوسی`);

const WRITE = rx(`${WB}(?:write|writes|written|writing|notebooks?|copybooks?)${WB}|لکھ|کاپی`);
const IN_BOOK = rx(`${WB}in (?:the|their|your|a) books?${WB}`);
const READING = rx(`${WB}read|${WB}open|${WB}p\\.\\s?[0-9]|پڑھ`);
const BOARD = rx(`${WB}board${WB}|بورڈ|تختہ|${WB}teacher${WB}`);
const MARK = rx(`${WB}(?:draws?|drawing|sketch(?:es)?|circles?|underlines?|labels?|rewrite)${WB}`);
const THUMBS = rx('thumb|انگوٹھ|👍');
const CLAUSE = /\.(?![0-9])|[;,!?؟،۔؛]/gu;

module.exports = {
  ORDER, CORE, TOTAL, MAX_MOVES, NEIGHBOUR, CAPS, MISTAKE_CAP, SUCCESS_CAP, CHECK_CAPS, STUCK_CAP, TURN_CAPS, HELP_CAP,
  PIC_KINDS, PENDING, SLATE, CONTENT_PAIRS, HOME, ANSWERED, PAIR, WRITE, IN_BOOK, READING, BOARD, MARK, THUMBS, CLAUSE, BS,
};
