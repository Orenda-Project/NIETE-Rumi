'use strict';

/**
 * Soniox text preparation (prepareForSoniox) and request splitting (splitForSoniox).
 *
 * Soniox reads its input more literally than ElevenLabs did: it voices slashes, underscores,
 * arrows and keycap emoji, says "hyphen" inside a hyphenated number word, drops the point in a
 * decimal written as "thirty-one.three", and may read an unknown [bracketed] direction aloud.
 * The module fixes that with six ordered steps; these tests pin each step, the order, and the
 * splitter's invariants. Every sample sentence here is synthetic.
 */

const {
  prepareForSoniox,
  splitForSoniox,
  TAG_MAP,
  SONIOX_TAGS,
} = require('../../bot/shared/services/tts/text/soniox-text');

const ur = (text) => prepareForSoniox(text, 'ur').text;
const en = (text) => prepareForSoniox(text, 'en').text;
const cp = (s) => [...s].length;
const keycap = (digit) => `${digit}\uFE0F\u20E3`;

describe('prepareForSoniox, step 1: keycaps and emoji', () => {
  it('reads a keycap digit as a number word followed by a stop', () => {
    expect(ur(`${keycap(1)} پہلا قدم`)).toBe('ایک۔ پہلا قدم۔');
    expect(en(`${keycap(1)} First step`)).toBe('one. First step.');
  });

  it('accepts a keycap without the variation selector, and the single keycap-ten emoji', () => {
    expect(ur('2\u20E3 دوسرا۔')).toBe('دو۔ دوسرا۔');
    expect(ur('\u{1F51F} آخری۔')).toBe('دس۔ آخری۔');
    expect(en('\u{1F51F} Last.')).toBe('ten. Last.');
  });

  it('reads keycaps in the middle of a line too', () => {
    expect(ur(`مراحل: ${keycap(1)} سنیں ${keycap(2)} سوچیں ${keycap(3)} بولیں۔`))
      .toBe('مراحل: ایک۔ سنیں دو۔ سوچیں تین۔ بولیں۔');
  });

  it('removes emoji, skin tones, zero-width joiners and flags', () => {
    // star, clapping hands + skin tone, woman teacher (ZWJ sequence), flag pair, heart + VS16, check, white star
    const emoji = '\u{1F31F}\u{1F44F}\u{1F3FD}';
    const tail = '\u{1F469}\u200D\u{1F3EB}\u{1F1F5}\u{1F1F0}\u2764\uFE0F\u2705\u2B50';
    expect(ur(`بہت اچھا! ${emoji} شاباش${tail}۔`)).toBe('بہت اچھا! شاباش۔');
    expect(en('Great job \u{1F389}\u{1F44D}')).toBe('Great job.');
  });

  it('keeps the zero-width non-joiner, which is part of Urdu spelling', () => {
    expect(ur('نقطۂ\u200Cنظر۔')).toBe('نقطۂ\u200Cنظر۔');
  });

  it('drops a leftover keycap mark, so keycap zero is left as a plain digit', () => {
    expect(ur(`${keycap(0)} سے شروع کریں۔`)).toBe('zero سے شروع کریں۔');
  });
});

describe('prepareForSoniox, step 2: markdown and line structure', () => {
  it('unwraps bold, italic and strikethrough marks and keeps the words', () => {
    expect(ur('یہ **اہم** بات ہے۔')).toBe('یہ اہم بات ہے۔');
    expect(ur('یہ __اہم__ بات ہے۔')).toBe('یہ اہم بات ہے۔');
    expect(ur('یہ *اہم* بات ہے۔')).toBe('یہ اہم بات ہے۔');
    expect(ur('یہ _اہم_ بات ہے۔')).toBe('یہ اہم بات ہے۔');
    expect(ur('یہ ~غلط~ بات ہے۔')).toBe('یہ غلط بات ہے۔');
    expect(en('This is **very** *really* _quite_ __truly__ ~not~ it.'))
      .toBe('This is very really quite truly not it.');
  });

  it('leaves underscores inside a word alone, doubled ones included', () => {
    expect(en('Open file_name_here now.')).toBe('Open file_name_here now.');
    expect(en('Call get__value__now here.')).toBe('Call get__value__now here.');
  });

  it('removes heading, bullet and numbered-list markers and ends each line with a stop', () => {
    expect(ur('# عنوان\n- پہلا نکتہ\n• دوسرا نکتہ\n1. تیسرا نکتہ\n2) چوتھا نکتہ'))
      .toBe('عنوان۔ پہلا نکتہ۔ دوسرا نکتہ۔ تیسرا نکتہ۔ چوتھا نکتہ۔');
    expect(en('## Plan\n- first\n• second\n1. third\n2) fourth'))
      .toBe('Plan. first. second. third. fourth.');
  });

  it('adds no stop after a line that already ends in punctuation, even behind a closing quote', () => {
    expect(ur('سوال؟\nجواب!\nنوٹ:\nپہلا، دوسرا،\nختم۔')).toBe('سوال؟ جواب! نوٹ: پہلا، دوسرا، ختم۔');
    expect(ur('اس نے کہا "ٹھیک ہے۔"\nاگلا')).toBe('اس نے کہا "ٹھیک ہے۔" اگلا۔');
    expect(en('He said "fine."\nNext')).toBe('He said "fine." Next.');
  });

  it('adds a stop after a closing quote that has no punctuation inside it', () => {
    expect(ur('"مل کر سوچو"')).toBe('"مل کر سوچو"۔');
  });

  it('adds no stop to a line holding only tags, or to a blank line', () => {
    expect(ur('[warmly]\nسلام')).toBe('[warm] سلام۔');
    expect(ur('[warmly] [pause]\n\n\nسلام')).toBe('[warm] [pause] سلام۔');
  });
});

describe('prepareForSoniox, step 3: symbols as words', () => {
  it('writes a digit range as "from X to Y" before any number is spelled', () => {
    expect(ur('2-3 منٹ دیں۔')).toBe('two سے three منٹ دیں۔');
    expect(ur('10–15 منٹ۔')).toBe('ten سے fifteen منٹ۔');
    expect(en('Give 2-3 minutes.')).toBe('Give 2 to 3 minutes.');
    expect(en('Pages 4–5 and 6 — 7.')).toBe('Pages 4 to 5 and 6 to 7.');
  });

  it('reads an arrow as "then"', () => {
    expect(ur('A → B۔')).toBe('A، پھر B۔');
    expect(en('A → B.')).toBe('A, then B.');
    expect(en('plan -> teach ⇒ reflect.')).toBe('plan, then teach, then reflect.');
  });

  it('reads a plus sign between tokens as the word for plus', () => {
    expect(ur('x + y۔')).toBe('x جمع y۔');
    expect(en('x + y.')).toBe('x plus y.');
  });

  it('reads a slash between two words as "or", but leaves a slash between digits alone', () => {
    expect(ur('بچے/طلبہ۔')).toBe('بچے یا طلبہ۔');
    expect(en('teacher/student.')).toBe('teacher or student.');
    expect(en('up / down.')).toBe('up or down.');
    expect(en('Use 1/2 of the page.')).toBe('Use 1/2 of the page.');
    // Choice: a fraction or date stays as written in Urdu too (Ishita reads digits right).
    expect(ur('1/2 حصہ۔')).toBe('1/2 حصہ۔');
  });
});

describe('prepareForSoniox, step 4: Urdu numbers', () => {
  it('reads a decimal as "point" with the fraction digits one by one', () => {
    expect(ur('اوسط 31.3 رہا۔')).toBe('اوسط thirty one point three رہا۔');
    expect(ur('وقت 2.05 سیکنڈ۔')).toBe('وقت two point zero five سیکنڈ۔');
    expect(ur('صرف 0.5 حصہ۔')).toBe('صرف zero point five حصہ۔');
  });

  it('spells 0 to 99 as English words with no hyphen', () => {
    expect(ur('43 بچے، 70 کتابیں، 7 گروپ۔')).toBe('forty three بچے، seventy کتابیں، seven گروپ۔');
    expect(ur('0 غلطیاں، 10 سوال، 19 جواب، 99 نمبر۔'))
      .toBe('zero غلطیاں، ten سوال، nineteen جواب، ninety nine نمبر۔');
  });

  it('leaves 100 and above as digits', () => {
    expect(ur('سال 2026 میں 150 اسکول۔')).toBe('سال 2026 میں 150 اسکول۔');
  });

  it('writes a percent sign after a number as the word فیصد', () => {
    expect(ur('71.4% حاضری۔')).toBe('seventy one point four فیصد حاضری۔');
    expect(ur('50 % بچے۔')).toBe('fifty فیصد بچے۔');
    expect(ur('150% اضافہ۔')).toBe('150 فیصد اضافہ۔');
  });

  it('removes the hyphen from number words that arrive already spelled', () => {
    expect(ur('ninety-nine نمبر۔')).toBe('ninety nine نمبر۔');
    expect(ur('Forty-Two نمبر۔')).toBe('Forty Two نمبر۔');
    // JavaScript word boundaries treat Urdu letters as non-word, so a glued suffix still counts.
    expect(ur('ninety-nineواں۔')).toBe('ninety nineواں۔');
  });

  it('repairs the broken decimal "thirty-one.three" that the older normaliser emits', () => {
    expect(ur('صرف thirty-one.three فیصد۔')).toBe('صرف thirty one point three فیصد۔');
    expect(ur('seventy-one.four% حاضری۔')).toBe('seventy one point four فیصد حاضری۔');
  });

  it('does not touch digits that belong to a Latin word or id', () => {
    // Choice: a digit run glued to a Latin letter, directly or through a hyphen, is part of a name.
    expect(ur('v8 اور COVID-19 اور 4th اور 5G۔')).toBe('v8 اور COVID-19 اور 4th اور 5G۔');
  });

  it('leaves compound numeric tokens as digits, and keeps a large whole part as digits in a decimal', () => {
    // Choice: thousands groups, times and dotted versions stay as written; Ishita reads digits right.
    expect(ur('1,500 طلبہ، 10:30 بجے، 1.2.3 ورژن۔')).toBe('1,500 طلبہ، 10:30 بجے، 1.2.3 ورژن۔');
    expect(ur('150.5 نمبر۔')).toBe('150 point five نمبر۔');
  });

  it('applies no number rules to English', () => {
    expect(en('Grade 4 has 31.3% and 7 groups.')).toBe('Grade 4 has 31.3% and 7 groups.');
  });
});

describe('prepareForSoniox, step 5: tags', () => {
  it('maps our tags to Soniox tags and keeps them in place', () => {
    expect(ur('[warmly] سلام۔')).toBe('[warm] سلام۔');
    expect(ur('[ Enthusiastically ] سلام۔')).toBe('[excited] سلام۔');
    expect(ur('سلام [whispers] دوست۔')).toBe('سلام [whispering] دوست۔');
    expect(ur('[pause] سلام۔')).toBe('[pause] سلام۔');
  });

  it('removes a tag mapped to nothing without reporting it', () => {
    expect(prepareForSoniox('[conversational] سلام۔', 'ur')).toEqual({ text: 'سلام۔', dropped: [] });
  });

  it('removes and reports placeholders and unknown directions', () => {
    expect(prepareForSoniox('[استاد کا نام] سلام۔', 'ur'))
      .toEqual({ text: 'سلام۔', dropped: ['[استاد کا نام]'] });
    expect(prepareForSoniox('[Greeting] Hello there.', 'en'))
      .toEqual({ text: 'Hello there.', dropped: ['[Greeting]'] });
    expect(prepareForSoniox('[enthusiastic teacher voice] Hello.', 'en'))
      .toEqual({ text: 'Hello.', dropped: ['[enthusiastic teacher voice]'] });
  });

  it('drops a tag outside TAG_MAP even when Soniox knows it, so only curated directions reach the voice', () => {
    expect(prepareForSoniox('[softly] Hello.', 'en')).toEqual({ text: 'Hello.', dropped: ['[softly]'] });
  });

  it('treats object-prototype names as unknown text, not as map entries', () => {
    expect(prepareForSoniox('[constructor] [toString] Hi.', 'en'))
      .toEqual({ text: 'Hi.', dropped: ['[constructor]', '[toString]'] });
  });

  it('keeps bracketed text longer than 40 characters, which is content rather than a tag', () => {
    const long = `[${'x'.repeat(41)}]`;
    expect(prepareForSoniox(`${long} Hi.`, 'en')).toEqual({ text: `${long} Hi.`, dropped: [] });
  });

  it('exports the bench map verbatim plus whispers', () => {
    expect(TAG_MAP).toEqual({
      warmly: 'warm',
      enthusiastically: 'excited',
      enthusiastic: 'excited',
      encouragingly: 'reassuringly',
      encouraging: 'reassuringly',
      thoughtfully: 'calm',
      gently: 'softly',
      gentle: 'softly',
      empathetically: 'sincerely',
      proudly: 'delighted',
      proud: 'delighted',
      methodically: 'calm',
      laughs: 'laughs',
      slowly: 'slowly',
      pause: 'pause',
      excited: 'excited',
      curious: 'curious',
      calm: 'calm',
      happy: 'happy',
      warm: 'warm',
      relieved: 'relieved',
      reassuring: 'reassuringly',
      friendly: 'warm',
      conversational: null,
      clear: null,
      instructional: null,
      confident: null,
      whispers: 'whispering',
    });
  });

  it('exports the Soniox tag list and maps only onto tags in it', () => {
    expect(SONIOX_TAGS).toHaveLength(58);
    expect(SONIOX_TAGS).toEqual(expect.arrayContaining(['warm', 'whispering', 'long pause', 'clears throat']));
    for (const value of Object.values(TAG_MAP)) {
      if (value !== null) expect(SONIOX_TAGS).toContain(value);
    }
  });

  it('never emits a bracketed tag that Soniox does not know', () => {
    const inputs = [
      ...Object.keys(TAG_MAP).map((k) => `[${k}] سلام۔`),
      ...Object.keys(TAG_MAP).map((k) => `Hello [ ${k.toUpperCase()} ] there`),
      '[استاد کا نام] [Greeting] [enthusiastic teacher voice] [whispering] [softly] سلام۔',
    ];
    for (const input of inputs) {
      for (const language of ['ur', 'en']) {
        const { text } = prepareForSoniox(input, language);
        for (const [, tag] of text.matchAll(/\[([^\]]{1,40})\]/g)) expect(SONIOX_TAGS).toContain(tag);
      }
    }
  });
});

describe('prepareForSoniox, step 6: whitespace', () => {
  it('collapses every run of whitespace, newlines included, to one space and trims', () => {
    expect(ur('  سلام\n\n\tدنیا۔  ')).toBe('سلام۔ دنیا۔');
    expect(ur('سلام\r\nدنیا')).toBe('سلام۔ دنیا۔');
    expect(ur('ایک   دو\u00A0\u00A0تین۔')).toBe('ایک دو تین۔');
  });
});

describe('prepareForSoniox, end to end', () => {
  it('prepares an Urdu reply with markdown, bullets, a decimal, a percent, a tag, a slash and an emoji', () => {
    const input = [
      '[warmly] [استاد کا نام] السلام علیکم! \u{1F31F}',
      '*آج کا خلاصہ*',
      '- کلاس میں 12 سوالات پوچھے گئے',
      '- اوسط انتظار کا وقت 2.5 سیکنڈ رہا',
      '- 71.4% طلبہ/طالبات نے حصہ لیا',
      '',
      'اگلی بار 2-3 منٹ سوچنے کا وقت دیں → جوڑی میں بات کروائیں۔',
    ].join('\n');
    expect(prepareForSoniox(input, 'ur')).toEqual({
      text: '[warm] السلام علیکم! آج کا خلاصہ۔ کلاس میں twelve سوالات پوچھے گئے۔ '
        + 'اوسط انتظار کا وقت two point five سیکنڈ رہا۔ '
        + 'seventy one point four فیصد طلبہ یا طالبات نے حصہ لیا۔ '
        + 'اگلی بار two سے three منٹ سوچنے کا وقت دیں، پھر جوڑی میں بات کروائیں۔',
      dropped: ['[استاد کا نام]'],
    });
  });

  it('prepares an English reply the same way, without number rules', () => {
    const input = [
      '[enthusiastically] **Quick plan** \u2728',
      '1. Ask 2-3 open questions',
      '2. Pair students → share answers',
      '- Use think/pair/share',
      '',
      '[thoughtfully] Aim for 70% participation + clear wait time.',
      `${keycap(3)} Close with one exit ticket`,
    ].join('\n');
    expect(prepareForSoniox(input, 'en')).toEqual({
      text: '[excited] Quick plan. Ask 2 to 3 open questions. Pair students, then share answers. '
        + 'Use think or pair or share. [calm] Aim for 70% participation plus clear wait time. '
        + 'three. Close with one exit ticket.',
      dropped: [],
    });
  });

  it('uses the language code before any region suffix', () => {
    expect(prepareForSoniox('2 کتابیں۔', 'ur-PK').text).toBe('two کتابیں۔');
    expect(prepareForSoniox('A/B.', 'UR').text).toBe('A یا B.');
    expect(prepareForSoniox('2 books.', 'en-US').text).toBe('2 books.');
    expect(prepareForSoniox('2 books/pens.', undefined).text).toBe('2 books or pens.');
  });
});

describe('prepareForSoniox, robustness', () => {
  it.each([null, undefined, 42, {}, [], true])('returns empty text for the non-string %p', (value) => {
    expect(prepareForSoniox(value, 'ur')).toEqual({ text: '', dropped: [] });
  });

  it('returns empty text for an empty string', () => {
    expect(prepareForSoniox('', 'ur')).toEqual({ text: '', dropped: [] });
    expect(prepareForSoniox('   \n\t ', 'en')).toEqual({ text: '', dropped: [] });
  });

  it('returns empty text when nothing speakable is left, and still reports what it dropped', () => {
    expect(prepareForSoniox('[warmly] [Greeting]', 'ur')).toEqual({ text: '', dropped: ['[Greeting]'] });
    expect(prepareForSoniox('[pause]\n\n[warmly]', 'en')).toEqual({ text: '', dropped: [] });
    expect(prepareForSoniox('\u{1F44D}\u{1F389}', 'ur')).toEqual({ text: '', dropped: [] });
  });

  it('survives long runs of markup characters without throwing', () => {
    const noisy = `${'*_~'.repeat(3000)}${'['.repeat(500)}${'-'.repeat(500)}`;
    const { text, dropped } = prepareForSoniox(noisy, 'ur');
    expect(typeof text).toBe('string');
    expect(Array.isArray(dropped)).toBe(true);
  });
});

describe('splitForSoniox', () => {
  // A sentence of exactly n code points: four-letter words and single spaces, ending in `stop`.
  function sentenceOf(n, stop = '۔', letter = 'ب') {
    let body = '';
    while (cp(body) < n - 1) body += cp(body) % 5 === 4 ? ' ' : letter;
    if (body.endsWith(' ')) body = `${body.slice(0, -1)}${letter}`;
    return `${body}${stop}`;
  }

  it('keeps a short text in one part', () => {
    expect(splitForSoniox('پہلا جملہ۔ دوسرا جملہ؟')).toEqual(['پہلا جملہ۔ دوسرا جملہ؟']);
  });

  it('packs whole sentences greedily while a part stays within targetChars', () => {
    const s = ['ب', 'پ', 'ت', 'ٹ', 'ث'].map((letter) => sentenceOf(120, '۔', letter));
    const parts = splitForSoniox(s.join(' '), { targetChars: 300 });
    expect(parts).toEqual([`${s[0]} ${s[1]}`, `${s[2]} ${s[3]}`, s[4]]);
    for (const part of parts) expect(cp(part)).toBeLessThanOrEqual(300);
  });

  it('lets one sentence exceed targetChars when it fits within maxChars', () => {
    const s = sentenceOf(500);
    expect(splitForSoniox(s)).toEqual([s]);
  });

  it('breaks a sentence longer than maxChars after its last clause mark', () => {
    const head = sentenceOf(600, '،', 'ب');
    const tail = sentenceOf(399, '۔', 'پ');
    const long = `${head} ${tail}`;
    expect(cp(long)).toBe(1000);
    expect(splitForSoniox(long, { maxChars: 900 })).toEqual([head, tail]);
  });

  it('breaks a long sentence with no clause mark at its last space before maxChars', () => {
    const long = sentenceOf(1000);
    const parts = splitForSoniox(long, { maxChars: 900 });
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(cp(part)).toBeLessThanOrEqual(900);
    expect(parts.join(' ')).toBe(long);
  });

  it('cuts a single word longer than maxChars at maxChars', () => {
    const word = 'ب'.repeat(1000);
    const parts = splitForSoniox(word, { maxChars: 900 });
    expect(parts.map(cp)).toEqual([900, 100]);
    expect(parts.join('')).toBe(word);
  });

  it('ends sentences at Urdu ۔ and ؟ as well as . ! ?, keeping the mark with its sentence', () => {
    expect(splitForSoniox('پہلا سوال؟ دوسرا جواب۔ Third one! Fourth. Fifth?', { targetChars: 1 }))
      .toEqual(['پہلا سوال؟', 'دوسرا جواب۔', 'Third one!', 'Fourth.', 'Fifth?']);
  });

  it('does not end a sentence at a decimal point or at a stop with no space after it', () => {
    expect(splitForSoniox('Score 3.5 today.Next part. End.', { targetChars: 1 }))
      .toEqual(['Score 3.5 today.Next part.', 'End.']);
  });

  it('gives back the input, whitespace collapsed, when the parts are joined with one space', () => {
    const messy = '  پہلا جملہ۔\n\n دوسرا   جملہ؟\tتیسرا!  ';
    const parts = splitForSoniox(messy, { targetChars: 12 });
    expect(parts.join(' ')).toBe('پہلا جملہ۔ دوسرا جملہ؟ تیسرا!');
    for (const part of parts) {
      expect(part).not.toBe('');
      expect(part).toBe(part.trim());
    }
  });

  it('measures length in code points, not UTF-16 units', () => {
    const wide = `${'\u{1D400}'.repeat(299)}.`; // 300 code points, 599 UTF-16 units
    expect(splitForSoniox(`${wide} ${wide}`, { targetChars: 300, maxChars: 300 })).toEqual([wide, wide]);
  });

  it('never returns a part longer than maxChars, even when targetChars is set higher', () => {
    const text = [1, 2, 3, 4].map(() => sentenceOf(200)).join(' ');
    const parts = splitForSoniox(text, { targetChars: 5000, maxChars: 450 });
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(cp(part)).toBeLessThanOrEqual(450);
    expect(parts.join(' ')).toBe(text);
  });

  it('returns no parts for empty or non-string input, and tolerates null options', () => {
    expect(splitForSoniox('')).toEqual([]);
    expect(splitForSoniox('  \n ')).toEqual([]);
    expect(splitForSoniox(null)).toEqual([]);
    expect(splitForSoniox(undefined)).toEqual([]);
    expect(splitForSoniox(42)).toEqual([]);
    expect(splitForSoniox('Hi.', null)).toEqual(['Hi.']);
  });

  it('splits a prepared reply without losing or reordering a word', () => {
    const line = '- آج کلاس میں 12 سوالات پوچھے گئے اور بچوں نے جوڑی میں 2-3 منٹ بات کی';
    const prepared = prepareForSoniox(Array(40).fill(line).join('\n'), 'ur').text;
    const parts = splitForSoniox(prepared);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toBe(prepared);
    for (const part of parts) expect(cp(part)).toBeLessThanOrEqual(300);
  });
});
