const { validate, CORE, ORDER } = require('../../../shared/services/lp-v10-card/rules');
const { card, clone } = require('../../fixtures/lp-v10-card/load');

const bad = (...edits) => {
  const k = card();
  edits.forEach((fn) => fn(k));
  return validate(k);
};
const has = (errs, ...bits) => errs.some((e) => bits.every((b) => e.includes(b)));
const sec = (k, s) => k.sections.find((x) => x.sec === s);
const turnMove = (k) => k.sections.flatMap((s) => s.moves).find((m) => m.chip === 'ONE NEIGHBOUR TURN');
const urdu = (check = {}) => {
  const k = card();
  k.header.subject = 'Urdu';
  k.lang = 'ur';
  Object.assign(sec(k, 'check').moves[0], check);
  return k;
};
const english = (check = {}) => {
  const k = card();
  Object.assign(sec(k, 'check').moves[0], check);
  return k;
};

describe('rules: the v10 card content gates', () => {
  test('constants', () => {
    expect(ORDER).toEqual(['open', 'explain', 'we', 'you', 'check', 'hw']);
    expect(CORE).toEqual(ORDER.slice(0, 5));
  });
  test('the prototype validates clean', () => expect(validate(card())).toEqual([]));

  test('more than 8 moves refused', () => {
    expect(has(bad((k) => k.sections[1].moves.push(clone(k.sections[1].moves[0]))), '8 moves')).toBe(true);
  });
  test('minutes must be 40', () => {
    expect(has(bad((k) => { k.sections[0].minutes = 6; }), '40')).toBe(true);
    expect(bad((k) => { k.sections[0].minutes = 6; })).toContain('section minutes add to 41, not 40');
  });
  test('the judge time bar is enforced', () => {
    const errs = bad((k) => { k.sections[1].minutes = 11; k.sections[2].minutes = 8; });
    expect(has(errs, 'We Do')).toBe(true);
    expect(has(errs, 'I Do')).toBe(true);
    expect(has(errs, 'practice', 'under 60%')).toBe(true);
  });
  test('a move without covers is refused', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].covers = []; }), 'covers')).toBe(true);
  });
  test('exactly one neighbour turn, in We Do', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].chip = 'ONE NEIGHBOUR TURN'; }), 'neighbour')).toBe(true);
    expect(has(bad((k) => { delete k.sections[2].moves[1].chip; }), 'neighbour')).toBe(true);
  });
  test('You Do needs a clock, answers and a likely mistake', () => {
    expect(has(bad((k) => { delete k.sections[3].moves[0].clock; }), 'clock')).toBe(true);
    expect(has(bad((k) => { k.sections[3].answers = []; }), 'answers')).toBe(true);
    expect(has(bad((k) => { delete k.sections[3].mistake; }), 'mistake')).toBe(true);
  });
  test('Check needs what counts as correct', () => {
    expect(has(bad((k) => { delete k.sections[4].correct; }), 'correct')).toBe(true);
  });
  test('nothing stays design pending', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].how = 'design pending — not carried'; }), 'design pending')).toBe(true);
  });
  test('a missing core section is refused', () => {
    expect(has(bad((k) => { k.sections.splice(4, 1); }), 'check')).toBe(true);
    expect(has(bad((k) => { k.sections.splice(4, 1); }), 'missing section: check')).toBe(true);
  });
  test('sections out of order are refused', () => {
    expect(has(bad((k) => k.sections.reverse()), 'in that order')).toBe(true);
  });
  test('a picture after an unknown section is refused', () => {
    expect(has(bad((k) => { k.pictures[0].after = 'nowhere'; }), 'after')).toBe(true);
  });

  test('pair talk in the opening is refused (English and Urdu)', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].do = 'Buddies tell each other one thing they remember.'; }), 'opening')).toBe(true);
    expect(has(bad((k) => { k.sections[0].moves[0].how = 'اپنے ساتھی کو بتائیں۔'; }), 'opening')).toBe(true);
  });
  test('pair talk in explain or check is refused', () => {
    expect(has(bad((k) => { k.sections[4].moves[0].how = 'Children tell their neighbour how they feel.'; }), 'check')).toBe(true);
    expect(has(bad((k) => { k.sections[1].moves[0].how = 'Turn to your partner and say it.'; }), 'explain')).toBe(true);
  });
  test('long lines are refused', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].do = 'x '.repeat(60); }), 'do', 'long')).toBe(true);
    expect(has(bad((k) => { k.sections[3].mistake = 'y '.repeat(100); }), 'mistake', 'long')).toBe(true);
  });
  test('Urdu join (جوڑیں) is not pair talk; Urdu pairs (جوڑیاں) are', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].how = 'حروف جوڑیں اور لفظ بنائیں۔'; }), 'opening')).toBe(false);
    expect(has(bad((k) => { k.sections[0].moves[0].how = 'بچے جوڑیاں بنائیں۔'; }), 'opening')).toBe(true);
  });
  test('length counts code points, so an emoji is one character', () => {
    expect(has(bad((k) => { k.sections[0].moves[0].do = '😀'.repeat(70); }), 'do is')).toBe(false);
    expect(bad((k) => { k.sections[0].moves[0].do = '😀'.repeat(71); })).toContain('move 1: do is 71 characters, too long (max 70)');
  });
  test('Check needs an "I can" success line, short', () => {
    expect(has(bad((k) => { delete k.sections[4].success; }), 'success')).toBe(true);
    expect(has(bad((k) => { k.sections[4].success = 'Children write a reason.'; }), 'I can')).toBe(true);
    expect(has(bad((k) => { k.sections[4].success = 'I can ' + 'x'.repeat(90); }), 'success', 'long')).toBe(true);
  });
  test('You Do needs an If stuck line, short', () => {
    expect(has(bad((k) => { delete k.sections[3].stuck; }), 'stuck')).toBe(true);
    expect(has(bad((k) => { k.sections[3].stuck = 'x'.repeat(130); }), 'stuck', 'long')).toBe(true);
  });
  test('a key word taught on the card is vocabulary, not pair talk', () => {
    const vocab = (k) => { k.words = ['neighbour', 'share']; k.sections[0].moves[0].how = 'Say the new word neighbour; the class echoes it.'; };
    expect(has(bad(vocab), 'opening')).toBe(false);
    const talk = (k) => { k.words = ['neighbour']; k.sections[0].moves[0].how = 'Turn to the child beside you.'; };
    expect(has(bad(talk), 'opening')).toBe(true);
  });
  test('the neighbour turn needs who first, both lines and a stop', () => {
    expect(has(bad((k) => delete turnMove(k).turn), 'neighbour turn', 'turn')).toBe(true);
    for (const f of ['first', 'a', 'b', 'stop']) {
      expect(has(bad((k) => delete turnMove(k).turn[f]), `turn.${f}`)).toBe(true);
    }
    expect(has(bad((k) => { turnMove(k).turn.a = 'x'.repeat(90); }), 'turn.a', 'long')).toBe(true);
  });
  test('the two neighbour lines must differ', () => {
    expect(has(bad((k) => { turnMove(k).turn.b = turnMove(k).turn.a; }), 'b repeats a')).toBe(true);
  });
  test('a card names a girl and a boy and uses both', () => {
    expect(has(bad((k) => delete k.names), 'names')).toBe(true);
    expect(has(bad((k) => delete k.names.boy), 'boy')).toBe(true);
    expect(has(bad((k) => { k.names.girl = 'Zzyzx'; }), 'Zzyzx')).toBe(true);
  });
  test('a Maths opening needs a number-sense move, a yesterday line with a question and an answer', () => {
    const maths = (k) => { k.header.subject = 'Maths'; k.sections[0].moves.forEach((m) => { delete m.sense; delete m.yesterday; }); };
    const errs = bad(maths);
    expect(has(errs, 'number sense')).toBe(true);
    expect(has(errs, 'no yesterday line')).toBe(true);
    const asked = (k) => { maths(k); k.sections[0].moves[0].sense = true; k.sections[0].moves[0].yesterday = 'Yesterday we added.'; };
    expect(has(bad(asked), 'asks no recall question')).toBe(true);
    const full = (k) => { maths(k); k.sections[0].moves[0].sense = true; k.sections[0].moves[0].yesterday = 'Yesterday we added. What is 40 + 20? (60)'; };
    const ok = bad(full);
    expect(has(ok, 'number sense')).toBe(false);
    expect(has(ok, 'yesterday')).toBe(false);
  });
  test('the do line is one breath', () => {
    expect(bad((k) => { k.sections[0].moves[0].do = 'x'.repeat(71); })).toContain('move 1: do is 71 characters, too long (max 70)');
  });
  test('an English turn needs a short repair line; Maths does not', () => {
    expect(has(bad((k) => delete turnMove(k).turn.help), 'turn.help')).toBe(true);
    expect(has(bad((k) => { turnMove(k).turn.help = 'x'.repeat(50); }), 'turn.help', 'long')).toBe(true);
    const m = card();
    m.header.subject = 'Maths';
    delete turnMove(m).turn.help;
    expect(has(validate(m), 'turn.help')).toBe(false);
  });
  test('the opening recall names its expected answer (non-Maths)', () => {
    const k = card();
    k.sections[0].moves.forEach((m) => { m.say = 'Say it.'; m.how = 'Choral.'; });
    expect(has(validate(k), 'recall names no expected answer')).toBe(true);
  });
  test('the home link must appear outside the neighbour turn', () => {
    const k = card();
    const strip = (o) => (typeof o === 'string' ? o.replace(/home|house|family|market|street|shop|kitchen|mosque|park|village|bazaar/gi, 'x')
      : Array.isArray(o) ? o.map(strip) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([a, b]) => [a, strip(b)])) : o);
    k.sections = strip(k.sections);
    expect(has(validate(k), 'home link')).toBe(true);
  });
  test('the subject is one of three', () => {
    const k = urdu();
    k.header.subject = 'اردو';
    expect(has(validate(k), 'subject')).toBe(true);
  });
  test('a picture needs a known kind, items for faces and steps, a clean svg with readable text', () => {
    const errs = bad((k) => k.pictures.push(
      { id: 'a', after: 'explain', kind: 'blob' },
      { id: 'b', after: 'explain', kind: 'faces' },
      { id: 'c', after: 'explain', kind: 'svg', svg: '<svg onload="x()"><script>x()</script></svg>' },
      { id: 'd', after: 'explain', kind: 'svg', svg: '<svg><text font-size="9">a</text></svg>' }));
    expect(has(errs, 'picture a', 'kind')).toBe(true);
    expect(has(errs, 'picture b', 'needs items')).toBe(true);
    expect(has(errs, 'picture c', 'svg must be one <svg>')).toBe(true);
    expect(errs).toContain('picture d: svg text font-size 9 (min 12, labels 14)');
    const ok = bad((k) => k.pictures.push({ id: 'dg2', after: 'explain', kind: 'svg', title: '3 + 2', svg: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>' }));
    expect(ok).toEqual([]);
  });
  test('slates are refused', () => {
    expect(has(bad((k) => { k.sections[1].moves[0].how = 'Children hold up slates.'; }), 'slates')).toBe(true);
  });

  // Urdu reviewer notes, 13 Oct
  test('an Urdu turn needs a repair line', () => {
    const k = urdu();
    delete turnMove(k).turn.help;
    expect(has(validate(k), 'turn.help')).toBe(true);
  });
  test('an Urdu exit is not written', () => {
    expect(has(validate(urdu({ do: "جملہ بورڈ پر لکھیں، بچے 'لقب' کا معنی لکھیں۔" })), 'exit ticket', 'written')).toBe(true);
  });
  test('Urdu thumbs take a statement, not a question', () => {
    const q = urdu({ do: 'انگوٹھا اوپر یا نیچے: جملہ سنیں۔', say: '“کرکٹ میں آپ کون سے دو اعضا استعمال کرتے ہیں؟”' });
    expect(has(validate(q), 'thumbs')).toBe(true);
    const ok = urdu({ do: 'انگوٹھا اوپر یا نیچے: جملہ سنیں۔', say: '“کرکٹ میں ہم ہاتھ سے بیٹ پکڑتے ہیں۔”', how: 'ہر جملے پر انگوٹھا۔' });
    expect(has(validate(ok), 'thumbs') || has(validate(ok), 'written')).toBe(false);
  });
  test('English and Maths exits are not written either', () => {
    expect(has(validate(english({ do: 'Write one sentence alone in the book.' })), 'written')).toBe(true);
    const k = english({ how: 'Children solve 24 ÷ 6 in their books.' });
    k.header.subject = 'Maths';
    expect(has(validate(k), 'written')).toBe(true);
  });
  test('the teacher may write on the board', () => {
    expect(has(validate(english({ do: "Write 'cat' on the board; each child reads it aloud.", how: 'Point; three children answer alone.' })), 'written')).toBe(false);
    expect(has(validate(english({ do: 'Write 54.32 and 100.8 on the board.', how: 'Five say the difference aloud.', say: '“Subtract.”' })), 'written')).toBe(false);
    expect(has(validate(urdu({ do: 'بورڈ پر جملہ لکھیں؛ بچے بلند آواز سے پڑھیں۔', how: 'پانچ بچے اکیلے جواب دیں۔', say: '“جملہ پڑھیں۔”' })), 'written')).toBe(false);
  });
  test('English thumbs take a statement', () => {
    expect(has(validate(english({ do: 'Thumbs up or down.', say: '“Which word is the opposite of hot?”' })), 'thumbs')).toBe(true);
  });
  test('children do not draw or mark in the exit; the teacher may draw on the board', () => {
    for (const d of ["Alone: draw hands to show 7 o'clock.", 'Alone: circle manner, underline time.', 'Alone: label two lines F or NF.',
      'Solve it, sketch it.', 'Rewrite in the past: “We plant a tree.”']) {
      expect(has(validate(english({ do: d })), 'written')).toBe(true);
    }
    expect(has(validate(english({ say: '“Draw the twos, then hop.”' })), 'written')).toBe(true);
    for (const d of ['Draw 3 groups of 2 on the board. Say the fact.', 'Teacher draws the jumps; five say each answer.']) {
      expect(has(validate(english({ do: d, how: 'Five say it aloud.', say: '“Say it.”' })), 'written')).toBe(false);
    }
  });
});
