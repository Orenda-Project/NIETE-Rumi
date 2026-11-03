'use strict';
/**
 * A read-aloud card whose pronoun has no antecedent (v37 G2 English: «Another door appeared, and he stepped inside.»,
 * two book passages spliced, so «he» names nobody). The teacher reads the card word for word, so the child hears a
 * sentence about nobody. `orphanPronouns(script)` lists each he / she / they / it / his / her / him / them that no
 * earlier name or noun in the card can stand for; the oral reader flags the task for one re-ask.
 *
 *   antecedent for he, she, his, her, him, they, them: a name, or a person or animal noun, earlier in the card.
 *   antecedent for it: any earlier «the / a / an / this / that + word», or a person or animal noun.
 *   «It was / It is / It's» opening a sentence is the weather-and-time «it» and is never reported.
 *
 * Pure. English only: an Urdu or empty card gives []. Never throws.
 */

const PERSON = new Set(('boy girl man woman mother father mama baba brother sister friend friends teacher grandmother grandfather uncle aunt '
  + 'children child kids students boys girls people farmer king queen prince princess doctor baby family parents men women '
  + 'dog cat bird fox lion rabbit monkey crow hen cow elephant duck fish goat mouse bear parrot squirrel tiger donkey frog '
  + 'sparrow deer horse sheep puppy kitten cub owl wolf').split(' '));
const NOT_NAMES = new Set(('The A An This That These Those His Her Their Our My Your Its Some All Both Each Every Another Other One Two Three Four Five '
  + 'Many Few No Then When And But So Now Soon Once Today Yesterday Tomorrow Suddenly Later After Before Next First Finally '
  + 'There Here What Where How Why Who Which If In On At At Under Near Behind One Look Come Let Please Thank Good Sir Madam '
  + 'Miss Mr Mrs Not Do Does Did Is Are Was Were Can Could Will Would Have Has Had Just Also Too Very Maybe Yes Oh').split(' '));
const SUBJECT = new Set(['he', 'she', 'they', 'it', 'his', 'her', 'him', 'them']);
const THING = /\b(?:the|a|an|this|that)\s+[a-z]+/i;

const isEnglish = (s) => typeof s === 'string' && /[a-z]/i.test(s) && !/[؀-ۿ]/.test(s);
const sentences = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** True when this token, at position `i` of its sentence, names someone. */
function isName(tok, i) {
  const w = tok.replace(/'s$/i, '');
  if (!/^[A-Z][a-z]+$/.test(w) || w === 'I' || NOT_NAMES.has(w)) return false;
  return i > 0 || !/ly$/.test(w);
}

function orphanPronouns(script) {
  if (!isEnglish(script)) return [];
  const out = [];
  let person = false;
  let thing = false;
  for (const sentence of sentences(script)) {
    const dummy = /^It(?:\s+(?:was|is)|'s)\b/.test(sentence);
    const tokens = sentence.match(/[A-Za-z]+(?:'s)?/g) || [];
    let seen = '';
    tokens.forEach((tok, i) => {
      const low = tok.toLowerCase().replace(/'s$/, '');
      seen += `${tok} `;
      if (SUBJECT.has(low) && !(dummy && i === 0 && low === 'it')) {
        const ok = low === 'it' ? person || thing || THING.test(seen.slice(0, -tok.length - 1)) : person;
        if (!ok) out.push(low);
      }
      if (PERSON.has(low) || isName(tok, i)) person = true;
      if (i > 0 && THING.test(seen)) thing = true;
    });
    if (THING.test(sentence)) thing = true;
  }
  return out;
}

module.exports = { orphanPronouns };
