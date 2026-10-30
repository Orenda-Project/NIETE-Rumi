'use strict';
/**
 * What an image-model picture's describe/name must say so the key is the only reading (bd-5jmnfj.4.58.2).
 *  - A speech-bubble item: the paper prints the bubble (bd-5jmnfj.4.40), so the picture has none. v26 G1
 *    English Q13 described "the child on the right stands next to the printed bubble"; the model drew a bubble.
 *  - A masculine person (G1 Urdu Q7 ii, name "elderly grandfather with a cane") came back an old woman in a dress.
 * Pure: strings in, strings out.
 */

const BUBBLE = /bubble/i;
// "stands next to the printed bubble" is where the child stands, not a thing to draw.
const BESIDE_BUBBLE = /\s*(?:stands?|sits?)\s+(?:next to|beside|near)\s+the\s+(?:(?:printed|empty|speech|drawn)\s+)*bubble/gi;

/** The describe with no bubble in it: «stands next to the printed bubble» becomes «stands at the right edge», other bubble sentences go. */
function withoutBubbles(describe) {
  const text = String(describe || '').replace(BESIDE_BUBBLE, ' stands at the right edge of the picture');
  if (!BUBBLE.test(text)) return text;
  const kept = text.split(/(?<=[.!?])\s+/).filter((s) => !BUBBLE.test(s)).join(' ');
  return kept || text.replace(/\b(?:printed |empty |speech |thought )*bubbles?\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

const hasBubble = (describe) => BUBBLE.test(String(describe || ''));

const FEMALE = /\b(?:girl|woman|women|female|mother|mum|mummy|grandmother|grandma|sister|daughter|lady|queen|aunt|dadi|nani)\b|دادی|نانی|امی|بیٹی|لڑکی|بہن|خالہ|پھوپھی/i;
const OLD = /\b(?:grandfather|granddad|grandpa|dada|nana|elderly|old)\b|دادا|نانا/i;
const BOY = /\b(?:boy|son|brother|bhai)\b|لڑکا|بیٹا|بھائی/i;
const MAN = /\b(?:father|dad|daddy|abu|abbu|uncle|chacha|mamu|man|male|gentleman|king|husband)\b|ابو|ابا|چچا|ماموں|باپ|والد|آدمی|مرد/i;

const NOT_WOMAN = 'He is clearly a man, not a woman: no dress, no long hair, no scarf over the head.';
const NOTES = {
  old: `An old man with a white beard, a cap, a long kurta and trousers. ${NOT_WOMAN}`,
  man: `An adult man with short hair, a moustache and a cap, in a shirt and trousers. ${NOT_WOMAN}`,
  boy: 'A boy with short hair, in a shirt and trousers. He is clearly a boy, not a girl: no dress, no long hair, no ribbon.',
};

/** The line telling the artist a masculine person's markers, or '' for anything else (a thing, a feminine person). */
function genderNote(name) {
  const text = String(name || '');
  if (!text || FEMALE.test(text)) return '';
  if (OLD.test(text) && (MAN.test(text) || /\b(?:grandfather|granddad|grandpa|dada|nana)\b|دادا|نانا/.test(text))) return NOTES.old;
  if (BOY.test(text)) return NOTES.boy;
  if (MAN.test(text)) return NOTES.man;
  return '';
}

module.exports = { withoutBubbles, hasBubble, genderNote };
