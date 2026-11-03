/**
 * A read-aloud card prints a grammar slip (round 6 blocker, bd-5jmnfj.4.58.9.2): v35 G2 English card 3 read
 * «Pinky eyes were sparkling.», the possessive 's lost. A teacher reads the card aloud word for word, so the slip
 * reaches the child. The mend is deterministic for the lost possessive and a doubled word; an agreement slip
 * (she were, they was) is reported, not guessed at.
 */

const G = require('../../bot/shared/services/assessment/fde-read-aloud-grammar');

const card = (script, items = []) => ({ script, items });
const paper = (content) => ({ seen: {}, _layout: { oral: { content } } });

describe('mendText', () => {
  test('RED a name followed by a body noun and a verb takes the possessive: Pinky eyes were → Pinky\'s eyes were', () => {
    expect(G.mendText('Pinky eyes were sparkling.').text).toBe("Pinky's eyes were sparkling.");
  });
  test('works mid-sentence and for other names and nouns', () => {
    expect(G.mendText('Then Jojo bag was heavy.').text).toBe("Then Jojo's bag was heavy.");
    expect(G.mendText('She saw that Ali mother is kind.').text).toBe("She saw that Ali's mother is kind.");
  });
  test('a name already possessive, a subject verb, or a name at a vocative is left alone', () => {
    ['Pinky\'s eyes were sparkling.', 'Pinky saw that Aisha was drawing.', 'Pinky and Jojo are walking.',
      'Fatima Jinnah stepped up.', 'The eyes were bright.', 'Sir Riaz gave Pinky a tip.'].forEach((s) => {
      expect(G.mendText(s).text).toBe(s);
    });
  });
  test('a doubled word is collapsed: the the → the', () => {
    expect(G.mendText('She went to the the park.').text).toBe('She went to the park.');
  });
  test('a doubled word that is real English stays: had had, that that', () => {
    expect(G.mendText('She had had a long day.').text).toBe('She had had a long day.');
  });
  test('each mend carries a note', () => {
    expect(G.mendText('Pinky eyes were sparkling.').notes).toHaveLength(1);
  });
});

describe('slipsOf (reported, not mended)', () => {
  test('RED flags she were and they was', () => {
    expect(G.slipsOf('She were happy.')).toHaveLength(1);
    expect(G.slipsOf('They was late.')).toHaveLength(1);
  });
  test('clean text has none; "if she were" is the subjunctive, not a slip', () => {
    expect(G.slipsOf('She was happy. They were late.')).toEqual([]);
    expect(G.slipsOf('If she were a bird, she would fly.')).toEqual([]);
  });
});

describe('mendReadAloud', () => {
  test('RED mends the script and every item ask and answer of the oral sheet, never mutating its input', () => {
    const ex = paper([card('Hello. Pinky eyes were sparkling.', [{ ask: 'Pinky eyes were sparkling. Why?', answer: 'She was happy.' }])]);
    const { examJson, notes } = G.mendReadAloud(ex);
    expect(examJson._layout.oral.content[0].script).toBe("Hello. Pinky's eyes were sparkling.");
    expect(examJson._layout.oral.content[0].items[0].ask).toBe("Pinky's eyes were sparkling. Why?");
    expect(notes.length).toBeGreaterThan(0);
    expect(ex._layout.oral.content[0].script).toBe('Hello. Pinky eyes were sparkling.');
  });
  test('reports an agreement slip in the notes without changing the text', () => {
    const { examJson, notes } = G.mendReadAloud(paper([card('They was late.')]));
    expect(examJson._layout.oral.content[0].script).toBe('They was late.');
    expect(notes.some((n) => /They was/.test(n))).toBe(true);
  });
  test('a paper with no oral sheet, or junk, comes back as it was', () => {
    const ex = { seen: {} };
    expect(G.mendReadAloud(ex).examJson).toBe(ex);
    expect(G.mendReadAloud(null).notes).toEqual([]);
    expect(G.mendReadAloud(paper([null, 3, card(null)])).notes).toEqual([]);
  });
});

describe('wiring', () => {
  test('the early writer applies it to the oral sheet', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/assessment/fde-early-writer'), 'utf8');
    expect(src).toMatch(/mendReadAloud\(/);
  });
});
