'use strict';
/**
 * bd-s0ccn5.2.1 — the FLN plan PDF page: a pure HTML template a teacher can download, print or open in another app.
 * Text and pictures only (a PDF cannot play sound): audio and video are left out, never shown as broken players.
 * Urdu plans are right-to-left with the Nastaliq font and Urdu labels. The plan's markdown subset (`**bold**`,
 * `*italic*`, line breaks) is honoured; everything else stays literal text, escaped.
 */
const { renderFlnPlanHtml } = require('../../scripts/fln-pdf/template');

const img = (name, extra = {}) => ({ kind: 'image', src: `https://media.example.test/fln/image/${name}.png`, orig: `https://orig.example.test/${name}.png`, w: 400, h: 300, ...extra });
const audio = (name) => ({ kind: 'audio', src: `https://media.example.test/fln/audio/${name}.mp3`, orig: `https://orig.example.test/${name}.mp3`, role: 'sound' });
const video = (name) => ({ kind: 'video', src: `https://media.example.test/fln/video/${name}.mp4`, orig: `https://orig.example.test/${name}.mp4` });

function enPlan(over = {}) {
  return {
    id: 900003,
    subject: 'rh-en',
    lang: 'en',
    dir: 'ltr',
    title: 'Sounds of q, x, z',
    slo: ['Learners **hear** and say the sounds of q, x and z.'],
    resources: ['Flash cards'],
    minutes: { total: 30 },
    sections: [
      {
        kind: 'opening',
        minutes: 5,
        groups: [{ header: null, level: null, items: [
          { kind: 'say', text: 'Say **zz** together.', media: [audio('zz'), img('zebra', { caption_en: 'A zebra' })] },
          { kind: 'instruction', text: 'Point to the board.\nWait for quiet.', media: [video('intro')] },
        ] }],
      },
      {
        kind: 'independent_practice',
        minutes: 10,
        groups: [{ header: 'Group work', level: 'beginner', items: [{ kind: 'ask', text: 'What sound is this?', media: [] }, { kind: 'answer', text: 'zz', media: [] }] }],
      },
    ],
    ...over,
  };
}

const placement = { level: 1, pos: 2, count: 12 };

describe('renderFlnPlanHtml — an English plan', () => {
  const html = renderFlnPlanHtml(enPlan(), { placement });

  test('is a whole left-to-right document titled with the plan', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<html lang="en" dir="ltr">/);
    expect(html).toContain('<title>Sounds of q, x, z</title>');
    expect(html).toContain('<h1>Sounds of q, x, z</h1>');
  });

  test('carries the subject, level, lesson position and total time', () => {
    expect(html).toContain('Reading Hour · English');
    expect(html).toContain('Level 1 · Lesson 2/12');
    expect(html).toContain('30 min');
  });

  test('lists the outcomes and what to bring, with the bold kept', () => {
    expect(html).toContain('Learning outcomes');
    expect(html).toContain('Learners <b>hear</b> and say');
    expect(html).toContain('Bring');
    expect(html).toContain('Flash cards');
  });

  test('every section in order with its label and minutes', () => {
    const a = html.indexOf('Opening');
    const b = html.indexOf('Independent practice');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(html).toContain('5 min');
    expect(html).toContain('10 min');
  });

  test('moves keep their kind labels, group headers and levels', () => {
    expect(html).toContain('Say:');
    expect(html).toContain('Ask:');
    expect(html).toContain('Answer:');
    expect(html).toContain('Group work');
    expect(html).toContain('Beginner');
    expect(html).toContain('Say <b>zz</b> together.');
    expect(html).toContain('Point to the board.<br>Wait for quiet.');
  });

  test('pictures are in, with their caption; sound and video are left out', () => {
    expect(html).toContain('src="https://media.example.test/fln/image/zebra.png"');
    expect(html).toContain('A zebra');
    expect(html).not.toMatch(/\.mp3|\.mp4|<audio|<video/);
  });

  test('a picture source can be re-addressed by the caller', () => {
    const out = renderFlnPlanHtml(enPlan(), { placement, imageSrc: (m) => m.orig });
    expect(out).toContain('src="https://orig.example.test/zebra.png"');
    expect(out).not.toContain('media.example.test/fln/image');
  });

  test('a picture with no usable source is dropped, not drawn broken', () => {
    const p = enPlan();
    p.sections[0].groups[0].items[0].media = [img('x', { src: '' })];
    expect(renderFlnPlanHtml(p, { placement })).not.toContain('<img');
  });

  test('the caller-supplied font CSS is embedded; none is read from disk here', () => {
    const out = renderFlnPlanHtml(enPlan(), { placement, fontCss: '@font-face{font-family:X}' });
    expect(out).toContain('@font-face{font-family:X}');
  });

  test('the footer names the plan id', () => {
    expect(html).toContain('ID 900003');
  });

  test('without a placement the kicker falls back to the subject alone', () => {
    const out = renderFlnPlanHtml(enPlan(), {});
    expect(out).toContain('Reading Hour · English');
    expect(out).not.toContain('Lesson ');
  });
});

describe('renderFlnPlanHtml — an Urdu plan', () => {
  const plan = {
    id: 900010,
    subject: 'rh-ur',
    lang: 'ur',
    dir: 'rtl',
    title: 'حروف کی مشق ۲ اور 3',
    slo: ['طلبہ حروف پہچانیں گے'],
    resources: [],
    minutes: { total: 30 },
    sections: [{ kind: 'opening', minutes: 5, groups: [{ header: 'حروف کا تعارف', level: 'advance', items: [{ kind: 'say', text: 'کہیں **ب**', media: [audio('b')] }] }] }],
  };
  const html = renderFlnPlanHtml(plan, { placement: { level: 2, pos: 3, count: 40 } });

  test('is right-to-left in Urdu with the Nastaliq family', () => {
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    expect(html).toContain('Noto Nastaliq Urdu');
  });

  test('labels are Urdu with Urdu digits', () => {
    expect(html).toContain('ریڈنگ آور — اردو');
    expect(html).toContain('سطح ۲ — سبق ۳ (کل ۴۰)');
    expect(html).toContain('۳۰ منٹ');
    expect(html).toContain('آغاز');
    expect(html).toContain('کہیں:');
    expect(html).toContain('اعلیٰ گروپ');
    expect(html).toContain('سیکھنے کے نتائج');
  });

  test('the bold is kept and no sound is drawn', () => {
    expect(html).toContain('کہیں <b>ب</b>');
    expect(html).not.toMatch(/\.mp3|<audio/);
  });
});

describe('renderFlnPlanHtml — never trusts the plan text', () => {
  test('markup in a title, outcome, header or move is escaped', () => {
    const p = enPlan({ title: '<script>alert(1)</script>', slo: ['<b>&</b> <img src=x onerror=1>'] });
    p.sections[0].groups[0].header = '"><i>';
    p.sections[0].groups[0].items[0].text = '<img src=x onerror=alert(1)> **ok**';
    const html = renderFlnPlanHtml(p, { placement });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(html).toContain('&quot;&gt;&lt;i&gt;');
    expect(html).toContain('<b>ok</b>');
  });

  test('a picture URL cannot break out of its attribute', () => {
    const p = enPlan();
    p.sections[0].groups[0].items[0].media = [img('x', { src: 'https://a.test/x.png" onerror="alert(1)' })];
    const html = renderFlnPlanHtml(p, { placement });
    expect(html).not.toContain('" onerror="');
  });

  test('a non-http picture URL is dropped', () => {
    const p = enPlan();
    p.sections[0].groups[0].items[0].media = [img('x', { src: 'javascript:alert(1)' })];
    expect(renderFlnPlanHtml(p, { placement })).not.toContain('javascript:');
  });

  test('a stray star stays literal', () => {
    const p = enPlan();
    p.sections[0].groups[0].items[0].text = '2 * 3 = 6';
    expect(renderFlnPlanHtml(p, { placement })).toContain('2 * 3 = 6');
  });

  test('an empty or missing section list still renders a page', () => {
    const html = renderFlnPlanHtml(enPlan({ sections: undefined, slo: undefined, resources: undefined }), {});
    expect(html).toContain('<h1>Sounds of q, x, z</h1>');
  });
});

// bd-s0ccn5.3 — corpus v2 carries setup and homework as lists of {kind,text,media} moves, not strings: the
// 10152 render printed "[object Object]" in the Before-class box and left its flash-card picture out.
describe('renderFlnPlanHtml — setup and homework are moves', () => {
  const setup = [
    { kind: 'instruction', text: 'Put up the **flash cards**.', media: [img('cards', { caption_en: 'Flash cards' })] },
    { kind: 'instruction', text: 'Write the letters on the board.', media: [audio('letters')] },
  ];
  const homework = [{ kind: 'instruction', text: 'Find three things that start with z.', media: [img('hw')] }];
  const html = renderFlnPlanHtml(enPlan({ setup, homework }), { placement });

  test('never prints [object Object]', () => {
    expect(html).not.toContain('[object Object]');
  });
  test('each setup and homework move keeps its text, markdown honoured', () => {
    expect(html).toContain('Put up the <b>flash cards</b>.');
    expect(html).toContain('Write the letters on the board.');
    expect(html).toContain('Find three things that start with z.');
  });
  test('their pictures are drawn; their sound is not', () => {
    expect(html).toContain('src="https://media.example.test/fln/image/cards.png"');
    expect(html).toContain('<figcaption>Flash cards</figcaption>');
    expect(html).toContain('src="https://media.example.test/fln/image/hw.png"');
    expect(html).not.toContain('letters.mp3');
  });
  test('a plain-string setup still renders as before', () => {
    expect(renderFlnPlanHtml(enPlan({ setup: 'Arrange desks.' }), { placement })).toContain('Arrange desks.');
  });
});
