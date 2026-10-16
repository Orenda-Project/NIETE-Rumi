/**
 * The Jugnu copy deck (bot/shared/config/copy.v2.json): every child, teacher and WhatsApp string, EN and UR.
 * Surfaces lift strings from the deck byte for byte; nothing reads it at runtime. These tests hold the deck's
 * own rules so a lift never copies a broken string: caps in code points (worst case), the same placeholders in
 * both languages, Urdu isolates, no banned words on a child's screen, retired keys kept but marked, and the
 * no-break space inside units that must not wrap.
 */
const path = require('path');
const fs = require('fs');

const DECK_PATH = path.join(__dirname, '../../../shared/config/copy.v2.json');
const load = () => JSON.parse(fs.readFileSync(DECK_PATH, 'utf8'));

const LRI = '⁦', FSI = '⁨', PDI = '⁩', NBSP = ' ';
// worst-case expansion of each placeholder, in code points
const WORST = { name: 20, name2: 20, title: 24, code: 11, teacher: 24, n: 3, total: 3, done: 3, absent: 3, rung: 32, thing: 32, class: 12, enrolled: 7 };
const cp = (s) => [...s.replace(/\{(\w+)\}/g, (m, k) => 'x'.repeat(WORST[k] || m.length))].length;
const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort();
const isChild = (surface) => surface.startsWith('page.') && !surface.startsWith('page.teacher');

const entries = () => Object.entries(load()).filter(([k]) => k !== '_meta');
const live = () => entries().filter(([, v]) => !v.retired && !v.held);

describe('copy deck: shape', () => {
  test('the deck is v2.4.1 and every key has both languages, a surface, a cap and a switch', () => {
    const deck = load();
    expect(deck._meta.version).toBe('2.4.1');
    for (const [k, v] of entries()) {
      expect([k, typeof v.en, typeof v.ur, typeof v.surface, typeof v.switch]).toEqual([k, 'string', 'string', 'string', 'string']);
      expect([k, Number.isInteger(v.cap_cp)]).toEqual([k, true]);
      expect([k, v.en.length > 0 && v.ur.length > 0]).toEqual([k, true]);
    }
    expect(deck._meta.keys).toBe(entries().length);
  });

  test('every live string fits its cap in code points, worst case', () => {
    const over = live().flatMap(([k, v]) => ['en', 'ur'].filter((l) => cp(v[l]) > v.cap_cp).map((l) => `${k}.${l} ${cp(v[l])}>${v.cap_cp}`));
    expect(over).toEqual([]);
  });

  test('EN and UR carry the same placeholders', () => {
    const odd = live().filter(([, v]) => placeholders(v.en).join() !== placeholders(v.ur).join()).map(([k]) => k);
    expect(odd).toEqual([]);
  });
});

describe('copy deck: Urdu mechanics', () => {
  test('names, titles and things sit inside U+2068…U+2069; STOP and /quiz inside U+2066…U+2069', () => {
    const bad = [];
    for (const [k, v] of live()) {
      for (const m of v.ur.matchAll(/\{(name|name2|title|thing)\}/g)) {
        if (v.ur[m.index - 1] !== FSI || v.ur[m.index + m[0].length] !== PDI) bad.push(`${k} ${m[0]}`);
      }
      for (const atom of ['STOP', '/quiz']) {
        let i = v.ur.indexOf(atom);
        while (i >= 0) {
          if (v.ur[i - 1] !== LRI || v.ur[i + atom.length] !== PDI) bad.push(`${k} ${atom}`);
          i = v.ur.indexOf(atom, i + 1);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('no middle dot anywhere and no ASCII digit in Urdu prose', () => {
    const bad = [];
    for (const [k, v] of live()) {
      if (v.en.includes('·') || v.ur.includes('·')) bad.push(`${k} middot`);
      const prose = v.ur.replace(/\{\w+\}/g, '').replace(new RegExp(`${LRI}.*?${PDI}`, 'g'), '');
      if (/[0-9]/.test(prose)) bad.push(`${k} digit`);
    }
    expect(bad).toEqual([]);
  });

  test('«واٹس ایپ» and «ہوم اسکرین» never break: U+00A0 inside, never a plain space', () => {
    const bad = live().filter(([, v]) => /واٹس ایپ|ہوم اسکرین/.test(v.ur)).map(([k]) => k);
    expect(bad).toEqual([]);
    expect(load()['jg.bind.send_btn'].ur).toBe(`واٹس${NBSP}ایپ پر بھیجیں`);
  });

  test('a child question keeps its last pair together', () => {
    const deck = load();
    expect(deck['jg.help.q'].ur.endsWith(`رہی${NBSP}ہے؟`)).toBe(true);
    expect(deck['jg.who.turn'].ur).toBe(`کس کی باری${NBSP}ہے؟`);
  });
});

describe('copy deck: words', () => {
  const BAN_EN = [/\btest/i, /\bexam/i, /\bassess/i, /\bwrong\b/i, /\bWCPM\b/i, /\brank/i, /\bpercentile/i, /\bprize/i, /\breward/i, /\bunlock/i, /\bclever\b/i, /\bperfect\b/i, /\bgenius\b/i];
  const BAN_UR = ['امتحان', 'ٹیسٹ', 'غلط', 'نتیجہ', 'نتائج', 'انعام', 'ذہین', 'کامل'];

  test('no test or judging word on any child surface', () => {
    const bad = [];
    for (const [k, v] of live().filter(([, x]) => isChild(x.surface))) {
      for (const re of BAN_EN) if (re.test(v.en)) bad.push(`${k} ${re}`);
      for (const w of BAN_UR) if (v.ur.includes(w)) bad.push(`${k} ${w}`);
    }
    expect(bad).toEqual([]);
  });

  test('no live string claims that STOP deletes a reading', () => {
    const bad = live().filter(([, v]) => (/STOP|reading|recording/i.test(v.en) && /delet|erase/i.test(v.en))
      || (/STOP|ریکارڈنگ/.test(v.ur) && /مٹا|مٹائی|حذف/.test(v.ur))).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('copy deck v2.2: the new and retired keys', () => {
  test('the link-renew confirm card has its line and both controls', () => {
    const d = load();
    expect(d['jg.t.link_renew_confirm'].en).toBe('The old link will stop working for everyone. Forward the new one to the class group.');
    expect(d['jg.t.link_renew_go'].en).toBe('Make a new link');
    expect(d['jg.t.link_renew_keep'].en).toBe('Keep this link');
    for (const k of ['jg.t.link_renew_confirm', 'jg.t.link_renew_go', 'jg.t.link_renew_keep']) {
      expect([k, d[k].surface, d[k].switch]).toEqual([k, 'page.teacher', 'web_quiz_class_link']);
    }
  });

  test('the paused round line and the two-tap hand-over are teacher-held, never on a child-held screen', () => {
    const d = load();
    expect(d['jg.round.t_paused'].en).toBe('{done} of {total} played. Continue another day.');
    expect(d['jg.round.t_paused'].surface).toBe('page.teacher');
    expect(d['jg.round.t_paused'].cap_cp).toBeLessThanOrEqual(80);
    expect(d['jg.round.t_give_to'].en).toBe('Give the phone to {name}?');
    expect(d['jg.round.t_give_to'].ur).toContain(`${FSI}{name}${PDI}`);
    expect([d['jg.round.t_yes'].en, d['jg.round.t_not_yet'].en]).toEqual(['Yes', 'Not yet']);
  });

  test('the mic notice keeps its three facts and makes no deletion claim', () => {
    const n = load()['jg.keep.notice'];
    expect(n.en).toContain('One checker');
    expect(n.en).toContain('any time');
    expect(n.en).toContain('STOP');
    expect(n.ur).toContain(`${LRI}STOP${PDI}`);
    expect(n.ur).toContain('ایک');
    expect(n.ur).toContain('کسی بھی وقت');
    expect(load()['jg.keep.notice_ok'].en).toBe('Got it');
  });

  test('the keep-my-place card has a try-again line for a failed save', () => {
    const t = load()['jg.bind.try_again'];
    expect([t.surface, t.switch]).toEqual(['page.bind', 'web_quiz_phone_bind']);
    expect([...t.ur].length).toBeLessThanOrEqual(60);
  });

  test('retired keys are kept and marked, never deleted', () => {
    const d = load();
    for (const k of ['jg.round.c_still', 'jg.keep.q', 'jg.keep.yes', 'jg.keep.no', 'jg.keep.either', 'jg.keep.ask_grownup', 'jg.keep.sub_v2']) {
      expect([k, d[k] && d[k].retired]).toEqual([k, true]);
    }
    expect(d['jg.round.c_done'].retired).toBeUndefined();
  });
});

describe('copy deck v2.3: the new keys and the read FIXes', () => {
  const d = () => load();

  test('the bind sheet: the code-expiry line and the recordings sentence, name isolated', () => {
    const v = d()['jg.bind.valid_hour'];
    expect([v.en, v.surface, v.switch]).toEqual(['This code works for the next hour.', 'page.bind', 'web_quiz_phone_bind']);
    expect(cp(v.ur)).toBeLessThanOrEqual(40);
    const r = d()['jg.bind.notice_readings'];
    expect(r.en).toBe('Readings {name} makes with the microphone are kept too.');
    expect(r.ur).toContain(`${FSI}{name}${PDI}`);
    expect([r.surface, cp(r.en) <= 80, cp(r.ur) <= 80]).toEqual(['page.bind', true, true]);
  });

  test('the re-serve line never blames the child; the card line no longer promises a mic-free Trail', () => {
    const w = d()['jg.trail.welcome_back'];
    expect([w.en, w.surface, w.switch]).toEqual(["Welcome back! Let's carry on.", 'page.trail', 'web_quiz_challenge_v2']);
    expect(w.en).not.toMatch(/left|stopped|quit/i);
    expect(cp(w.ur)).toBeLessThanOrEqual(40);
    expect(d()['jg.card.sub'].en).toBe('2 minutes to start, no microphone');
    expect(d()['jg.card.sub'].ur).toContain('شروع');
  });

  test('the ping body: no parameter, no selection or test word, names STOP and /quiz, held until the go', () => {
    const p = d()['bot.ping.invite'];
    expect(placeholders(p.en).concat(placeholders(p.ur))).toEqual([]);
    expect(p.en).not.toMatch(/\b(pick|sampl|select|chos|test|exam)/i);
    expect(p.en).toContain('STOP');
    expect(p.en).toContain('/quiz');
    expect(p.ur).toContain(`${LRI}STOP${PDI}`);
    expect(p.ur).toContain(`${LRI}/quiz${PDI}`);
    expect([p.surface, p.switch, cp(p.en) <= 160, cp(p.ur) <= 160]).toEqual(['wa.body', 'web_quiz_sample_ping', true, true]);
    expect(typeof p.held).not.toBe('undefined');
  });

  test('the listen-error and library lines are keyed; the doubled "to" is gone', () => {
    expect(d()['jg.trail.listen_down'].en).toBe("The story won't play right now. Try another challenge.");
    expect(d()['jg.lib.lock_say'].en).toBe('Ask the child who got this link to open it.');
    expect(d()['jg.lib.lock_say'].en).not.toMatch(/\bto to\b/);
  });

  test('U+00A0 keeps the last pair together where the 360 px read found an orphan', () => {
    expect(d()['jg.lantern.trail_many'].ur.endsWith(`رہے${NBSP}ہیں۔`)).toBe(true);
    expect(d()['jg.card.title'].ur.endsWith(`کھیل${NBSP}ہے`)).toBe(true);
    expect(d()['jg.trail.welcome_back'].ur.endsWith(`چلتے${NBSP}ہیں۔`)).toBe(true);
  });

  test('the mic notice names the grown-up and says the reading stays, in both languages', () => {
    const n = d()['jg.keep.notice'];
    expect(n.en).toMatch(/A grown-up/);
    expect(n.en).toMatch(/the reading stays/);
    expect(n.ur).toContain('گھر کے بڑے');
    expect(n.ur).toContain('ریکارڈنگ پھر بھی');
    expect(cp(n.en)).toBeLessThanOrEqual(200);
    expect(cp(n.ur)).toBeLessThanOrEqual(200);
  });

  test('the failed save says what failed; the whose-turn exit says what it does', () => {
    expect(d()['jg.bind.try_again'].ur).toContain('جگہ محفوظ نہیں');
    expect(d()['jg.bind.try_again'].en).toMatch(/place/);
    expect([d()['jg.who.someone_else'].en, d()['jg.who.someone_else'].ur]).toEqual(["My name isn't here", 'میرا نام یہاں نہیں']);
  });
});

describe('copy deck v2.4: the STOP line names the number; the paused round card says how to carry on', () => {
  const d = () => load();

  test('the bind sheet STOP line names what STOP removes (the phone number), as the Urdu does, and nothing about readings', () => {
    const s = d()['jg.bind.notice_stop_phone_only'];
    expect(s.en).toBe('A grown-up can remove this phone number any time by sending STOP on WhatsApp.');
    expect(s.en).not.toMatch(/undo this/);
    expect(s.ur).toContain('یہ نمبر ہٹا');
    for (const w of [/eading/, /ecording/, /delet/i]) expect(s.en).not.toMatch(w);
    expect(cp(s.en)).toBeLessThanOrEqual(s.cap_cp);
  });

  test('the paused card: which button carries the round on (its own deck words), the list is kept, children see nothing', () => {
    const how = d()['jg.round.t_paused_how'];
    const kids = d()['jg.round.t_paused_kids'];
    for (const k of [how, kids]) expect([k.surface, k.switch]).toEqual(['page.teacher', 'web_quiz_class_round']);
    expect(how.en).toContain(`"${d()['jg.round.t_resume'].en}"`);
    expect(how.ur).toContain(`«${d()['jg.round.t_resume'].ur}»`);
    expect(how.en).toMatch(/list stays/);
    expect(kids.en).toBe('Until then, the children see nothing about the round.');
    for (const k of [how, kids]) {
      expect(placeholders(k.en).concat(placeholders(k.ur))).toEqual([]);
      expect([cp(k.en) <= k.cap_cp, cp(k.ur) <= k.cap_cp]).toEqual([true, true]);
      expect(k.ur.endsWith('۔')).toBe(true);
    }
    expect(how.ur.endsWith(`رہے${NBSP}گی۔`)).toBe(true);
    expect(kids.ur.endsWith(`نہیں${NBSP}آتا۔`)).toBe(true);
  });

  test('the new paused-card lines are lifted: live, no longer held (the round page renders both)', () => {
    for (const k of ['jg.round.t_paused_how', 'jg.round.t_paused_kids']) expect([k, d()[k].held, d()[k].retired]).toEqual([k, undefined, undefined]);
  });

  test('the deck says which file reads it at runtime', () => {
    expect(d()._meta.what).not.toMatch(/nothing reads this file at runtime/);
    expect(d()._meta.what).toMatch(/class-round\.page\.js/);
  });
});

describe('copy deck v2.4.1: the finish card counts the class, never places the child; the paused card is one tap', () => {
  const d = () => load();
  const WQ_JS = path.join(__dirname, '../../../../dashboard/public/wq/wq.js');

  test('the finish card: a count of the class that finished today, the child alone named by no number', () => {
    const one = d()['quiz.finish.count_one'];
    const many = d()['quiz.finish.count'];
    expect([one.en, one.ur]).toEqual(['You finished this quiz today!', 'آج آپ نے یہ کوئز مکمل کر لیا۔']);
    expect([many.en, many.ur]).toEqual(['{n} children in your class finished this quiz today.', 'آج آپ کی کلاس میں {n} بچوں نے یہ کوئز مکمل کیا۔']);
    for (const k of [one, many]) {
      expect([k.surface, k.held, k.retired]).toEqual(['page.scorecard', undefined, undefined]);
      expect([cp(k.en) <= k.cap_cp, cp(k.ur) <= k.cap_cp]).toEqual([true, true]);
      for (const l of ['en', 'ur']) expect(k[l]).not.toMatch(/\b(1st|2nd|3rd|\d+th|place|position)\b|نمبر|پوزیشن/);
      expect(k.ur.endsWith('۔')).toBe(true);
    }
    expect(placeholders(one.en).concat(placeholders(one.ur))).toEqual([]);
    expect([placeholders(many.en), placeholders(many.ur)]).toEqual([['{n}'], ['{n}']]);
  });

  test('the page shows the deck count lines byte for byte (wq.js T.nth, Urdu digits through urDigits)', () => {
    const src = fs.readFileSync(WQ_JS, 'utf8');
    const one = d()['quiz.finish.count_one'];
    const many = d()['quiz.finish.count'];
    expect(src).toContain(`if (n === 1) return '${one.en}';`);
    expect(src).toContain(`if (n === 1) return '${one.ur}';`);
    const [a, b] = many.en.split('{n}');
    expect(src).toContain(`return ['${a}', '<bdi>' + n + '</bdi>', '${b}'];`);
    const [c, e] = many.ur.split('{n}');
    expect(src).toContain(`return ['${c}', '<bdi>' + urDigits(n) + '</bdi>', '${e}'];`);
  });

  test('the paused card names one tap, its own "Continue" button, and no longer "Start the round"', () => {
    const how = d()['jg.round.t_paused_how'];
    expect(how.en).toBe(`To carry on, tap "${d()['jg.round.t_resume'].en}". The list stays as it is.`);
    expect(how.ur).toBe(`راؤنڈ آگے بڑھانے کے لیے «${d()['jg.round.t_resume'].ur}» دبائیں۔ فہرست جوں کی توں رہے${NBSP}گی۔`);
    expect(how.en).not.toContain(d()['jg.round.start'].en);
    expect(how.ur).not.toContain(d()['jg.round.start'].ur);
    expect(how.ur.split(d()['jg.round.t_resume'].ur).length).toBe(2);
  });
});
