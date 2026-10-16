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
  test('the deck is v2.2 and every key has both languages, a surface, a cap and a switch', () => {
    const deck = load();
    expect(deck._meta.version).toBe('2.2');
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

  test('retired keys are kept and marked, never deleted', () => {
    const d = load();
    for (const k of ['jg.round.c_still', 'jg.keep.q', 'jg.keep.yes', 'jg.keep.no', 'jg.keep.either', 'jg.keep.ask_grownup', 'jg.keep.sub_v2']) {
      expect([k, d[k] && d[k].retired]).toEqual([k, true]);
    }
    expect(d['jg.round.c_done'].retired).toBeUndefined();
  });
});
