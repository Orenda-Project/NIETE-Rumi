'use strict';
/**
 * The teacher's web report page (/r/<token>) — a pure renderer, data → HTML.
 *
 * The page is what a teacher opens from WhatsApp's in-app browser: who played,
 * who has NOT played (greyed, with a "Remind the class" link), each child's
 * score, every question's difficulty, and what to reteach. It carries no
 * JavaScript at all — every action is a link — and the PDF is the same HTML
 * rendered with print:true. Children's names are untrusted text and are
 * escaped; the chrome is ours.
 */
const { renderPage, renderMessagePage } = require('../../../shared/templates/teacher-report.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const LINK = 'https://portal.example.test/q/AB12CD';

function quizData(over = {}) {
  return {
    quiz: { id: 'q-1', topic: 'Parts of a plant', subject: 'science', grade: '5', source: 'lp_v8', language: 'en', date: '2026-10-05T09:00:00Z', code: 'AB12CD', link: LINK },
    roster: { state: 'known', className: '5-A', of: 4, lists: [{ id: 'l-5a', label: '5-A' }] },
    summary: { played: 2, of: 4, avg: 63, total: 4, hardestN: 3 },
    played: [
      { first: 'Ayesha', roll: 2, correct: 3, total: 4, pct: 75, onList: true },
      { first: 'Bilal', roll: 7, correct: 2, total: 4, pct: 50, onList: false },
    ],
    notPlayed: [{ first: 'Hina', roll: 1 }, { first: 'Omar', roll: 4 }],
    questions: [
      { n: 1, text: 'Which part takes in water?', answered: 2, correctPct: 100, wrongTop: null },
      { n: 2, text: 'What do leaves make?', answered: 2, correctPct: 50, wrongTop: { option: 'B', text: 'Water', pct: 100 } },
      { n: 3, text: 'Which part holds the plant up?', answered: 2, correctPct: 0, wrongTop: { option: 'C', text: 'Root', pct: 100 } },
      { n: 4, text: 'Where are seeds made?', answered: 0, correctPct: null, wrongTop: null },
    ],
    guidance: { muddled: 'Roots and stems were mixed up.', board: 'Draw a plant and label it.', check: 'Ask: which part drinks?' },
    reminder: { language: 'en', text: `📣 Our quiz on *Parts of a plant* is still open! If you have not played yet, tap the link and play today: ${LINK}` },
    ...over,
  };
}

const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '');
const page = (data, opts = {}) => renderPage({ quiz: data }, { lang: 'en', tab: 'quiz', tokens: { self: TOKEN }, ...opts });

describe('teacher report page — roster states', () => {
  test('known: tiles, greyed not-played chips sorted by roll, Remind the class link, Copy message without JS', () => {
    const html = page(quizData());
    // Bilal is not on 5-A's list: 1 of 4 on the list played, Bilal named apart
    expect(text(html)).toMatch(/1 of 4 played/);
    expect(text(html)).toMatch(/\+1 not on the list/);
    expect(html).toMatch(/Average/);
    expect(html).toMatch(/63%/);
    expect(html).toMatch(/Hardest/);
    expect(html).toMatch(/Q3/);
    expect(html).toMatch(/Not played yet/);
    const np = html.slice(html.indexOf('Not played yet'));
    expect(np.indexOf('Hina')).toBeGreaterThan(-1);
    expect(np.indexOf('Omar')).toBeGreaterThan(np.indexOf('Hina'));
    expect(html).toMatch(/class="[^"]*np-chip/);
    expect(html).toContain(`href="/r/${TOKEN}/remind?quiz=q-1"`);
    expect(html).toMatch(/Remind the class/);
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>[^<]*Copy message/);
    expect(html).toContain('If you have not played yet');
    expect(html).toContain(LINK);
  });

  test('ambiguous: no not-played list; asks which class with one link per class', () => {
    const html = page(quizData({
      roster: { state: 'ambiguous', className: null, of: null, lists: [{ id: 'l-3b', label: '3-B', key: 'k-3b' }, { id: 'l-3c', label: '3-C' }] },
      summary: { played: 2, of: null, avg: 63, total: 4, hardestN: 3 },
      notPlayed: null,
    }));
    expect(html).toMatch(/Which class was this for\?/);
    // a no-JS POST form, one button per class: binding is a write, never a GET
    expect(html).toMatch(new RegExp(`<form method="post" action="/r/${TOKEN.replace('.', '\\.')}/class"`));
    expect(html).toMatch(/<button[^>]*name="key" value="k-3b"[^>]*>3-B</);
    expect(html).toMatch(/<button[^>]*name="key" value="l-3c"[^>]*>3-C</);
    expect(html).toContain('<input type="hidden" name="quiz" value="q-1">');
    expect(html).not.toMatch(/\?class=/);
    expect(html).not.toMatch(/Not played yet/);
    expect(text(html)).toMatch(/2\s*played/);
    expect(text(html)).not.toMatch(/2\s*2 played/);
    expect(html).not.toMatch(/of null/);
  });

  test('none: tells the teacher how to add a class list, no not-played list', () => {
    const html = page(quizData({ roster: { state: 'none', className: null, of: null, lists: [] }, notPlayed: null, summary: { played: 2, of: null, avg: 63, total: 4, hardestN: 3 } }));
    expect(html).toMatch(/\/roster/);
    expect(html).toMatch(/see who has not played/i);
    expect(html).not.toMatch(/Not played yet/);
  });

  test('nobody played: an empty-state line instead of an empty table, no NaN or null', () => {
    const html = page(quizData({ played: [], summary: { played: 0, of: 4, avg: null, total: 4, hardestN: null }, notPlayed: [{ first: 'Hina', roll: 1 }] }));
    expect(html).toMatch(/No one has played yet/);
    expect(html).not.toMatch(/NaN|null|undefined/);
  });
});

describe('teacher report page — list numbers and children not on the list', () => {
  test('the number after a name is "list no." (the teacher\'s paste position), never a roll', () => {
    const html = page(quizData());
    expect(text(html)).toMatch(/Hina\s*list no\. 1/);
    expect(text(html)).toMatch(/Ayesha\s*list no\. 2/);
    expect(text(html)).not.toMatch(/#\d|Roll/);
    expect(text(page(quizData(), { lang: 'ur' }))).toMatch(/لسٹ نمبر/);
  });

  test('the identity v2 shape works too: number instead of roll', () => {
    const html = page(quizData({ notPlayed: [{ studentId: 's-9', first: 'Rida', number: 9 }] }));
    expect(text(html)).toMatch(/Rida\s*list no\. 9/);
  });

  test('a typed child not on the list: Add to <class> and This is… are POST forms naming the session', () => {
    const html = page(quizData({
      notPlayed: [{ studentId: 's-1', first: 'Hina', number: 1 }, { studentId: 's-4', first: 'Omar', number: 4 }],
      provisional: [{ sessionId: 'sess-7', studentId: 'p-7', typed: 'Alee', correct: 3, total: 4 }],
    }));
    const sec = html.slice(html.indexOf('id="provisional"'));
    expect(sec).toMatch(/Alee/);
    expect(sec).toMatch(new RegExp(`<form method="post" action="/r/${TOKEN.replace('.', '\\.')}/fix"`));
    expect(sec).toContain('<input type="hidden" name="ref" value="sess-7">');
    expect(sec).toMatch(/<button[^>]*name="add" value="1"[^>]*>Add to 5-A</);
    expect(sec).toMatch(/<select name="studentId"[^>]*>[\s\S]*<option value="s-1">Hina[\s\S]*<option value="s-4">Omar/);
    expect(html).not.toMatch(/<script/i);
  });

  test('identity v2\'s suggestion (a near match on the list) is preselected in This is…', () => {
    const html = page(quizData({
      notPlayed: [{ studentId: 's-1', first: 'Hina', number: 1 }, { studentId: 's-4', first: 'Omar', number: 4 }],
      provisional: [{ sessionId: 'sess-7', typed: 'Omer', correct: 3, total: 4, suggest: { studentId: 's-4', first: 'Omar', number: 4 } }],
    }));
    expect(html).toMatch(/<option value="s-4" selected>Omar/);
    expect(html).not.toMatch(/<option value="s-1" selected/);
  });

  test('no provisional rows, no section; the PDF never prints the forms', () => {
    expect(page(quizData())).not.toMatch(/id="provisional"/);
    const pdf = page(quizData({ provisional: [{ sessionId: 'sess-7', typed: 'Alee', correct: 3, total: 4 }] }), { print: true });
    expect(pdf).not.toMatch(/<form/);
    expect(pdf).toMatch(/Alee/);
  });

  test('a failed save comes back with a plain notice', () => {
    expect(text(page(quizData(), { notice: 'failed' }))).toMatch(/did not save/);
  });
});

describe('teacher report page — sections', () => {
  test('scores sorted as given with x/y, "not on list" tag for a child off the class list', () => {
    const html = page(quizData());
    const s = html.slice(html.indexOf('id="scores"'));
    expect(s.indexOf('Ayesha')).toBeLessThan(s.indexOf('Bilal'));
    expect(s).toMatch(/3\/4/);
    expect(s).toMatch(/not on list/);
  });

  test('question by question: every question, % right, difficulty band, most-chosen wrong answer', () => {
    const html = page(quizData());
    expect(html).toMatch(/Q1 · 100% right/);
    expect(html).toMatch(/Q2 · 50% right/);
    expect(html).toMatch(/Q3 · 0% right/);
    expect(html).toMatch(/Q4 · not answered yet/);
    expect(html).toMatch(/band-green/);
    expect(html).toMatch(/band-amber/);
    expect(html).toMatch(/band-red/);
    expect(html).toContain('Root');
  });

  test('what to reteach: the stored guidance blocks; a placeholder when absent', () => {
    expect(page(quizData())).toContain('Draw a plant and label it.');
    expect(page(quizData({ guidance: { secure: 'All of it', stretch: 'Try seeds' } }))).toContain('Try seeds');
    expect(page(quizData({ guidance: null }))).toMatch(/guidance arrives with the report PDF/);
  });

  test('footer: Export PDF and All my classes are links; header carries class and source', () => {
    const html = page(quizData());
    expect(html).toContain(`href="/r/${TOKEN}/pdf?lang=en"`);
    expect(html).toContain(`href="/r/${TOKEN}?tab=class&amp;lang=en"`);
    expect(html).toMatch(/Class 5-A/);
    expect(html).toMatch(/From lesson plan/);
  });
});

describe('teacher report page — maths', () => {
  const mathsQuiz = () => quizData({
    questions: [
      { n: 1, text: 'A resistor is $60\\,\\Omega$. What is the current?', answered: 2, correctPct: 50, wrongTop: { option: 'B', text: '$\\frac{1}{2}$ A', pct: 100 } },
    ],
  });
  test('stems and wrong answers are typeset (KaTeX), never raw $…$ or spelled-out commands', () => {
    for (const opts of [{}, { print: true }, { lang: 'ur' }]) {
      const html = page(mathsQuiz(), opts);
      const body = html.slice(html.indexOf('id="questions"'));
      expect(body).toMatch(/class="katex/);
      expect(text(body)).not.toMatch(/\$/);
      expect(text(body)).not.toMatch(/Omega|frac/);
      expect(html).toMatch(/\.qm,\.qm \.katex/);
    }
  });
  test('a page with no maths carries no KaTeX stylesheet', () => {
    expect(page(quizData())).not.toMatch(/\.qm,\.qm \.katex/);
  });
  test('maths does not open a hole for markup in the prose around it', () => {
    const html = page(quizData({ questions: [{ n: 1, text: '<i>x</i> is $2+2$', answered: 1, correctPct: 100, wrongTop: null }] }));
    expect(html).toContain('&lt;i&gt;x&lt;/i&gt;');
  });
});

describe('teacher report page — safety', () => {
  test('no JavaScript anywhere: no <script>, no on*= handlers, no javascript: URLs', () => {
    for (const html of [page(quizData()), page(quizData(), { lang: 'ur' }), page(quizData(), { print: true })]) {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).not.toMatch(/javascript:/i);
    }
  });

  test('a child name with markup stays text', () => {
    const html = page(quizData({
      played: [{ first: '<b>Zed</b>', roll: 3, correct: 1, total: 4, pct: 25, onList: true }],
      notPlayed: [{ first: '<img src=x onerror=alert(1)>', roll: 9 }],
    }));
    expect(html).toContain('&lt;b&gt;Zed&lt;/b&gt;');
    expect(html).not.toContain('<b>Zed</b>');
    expect(html).not.toContain('<img src=x');
  });

  test('topic and question text are escaped too', () => {
    const html = page(quizData({ quiz: { ...quizData().quiz, topic: 'A & B <i>x</i>' } }));
    expect(html).toContain('A &amp; B &lt;i&gt;x&lt;/i&gt;');
  });
});

describe('teacher report page — language', () => {
  test('UR: dir=rtl lang=ur, a Nastaliq @font-face, Urdu chrome, no English chrome', () => {
    const html = page(quizData(), { lang: 'ur' });
    expect(html).toMatch(/<html[^>]*dir="rtl"[^>]*lang="ur"/);
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu'/);
    expect(html).toMatch(/ابھی نہیں کھیلا/);
    expect(html).not.toMatch(/Not played yet|Remind the class|Export PDF/);
  });

  test('UR print (the PDF): Noto Nastaliq embedded as base64, not fetched', () => {
    const html = page(quizData(), { lang: 'ur', print: true });
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{100,}/);
  });

  test('EN: dir=ltr, no Nastaliq payload in the screen page', () => {
    const html = page(quizData());
    expect(html).toMatch(/<html[^>]*dir="ltr"[^>]*lang="en"/);
    expect(html).not.toMatch(/font-family:'NastaliqUrdu'[^}]*base64/);
  });

  test('the .ltr isolate carries BOTH unicode-bidi:isolate and direction:ltr', () => {
    const html = page(quizData(), { lang: 'ur' });
    const rule = (html.match(/\.ltr[,{][^}]*\}/) || [''])[0];
    expect(rule).toMatch(/unicode-bidi:isolate/);
    expect(rule).toMatch(/direction:ltr/);
  });

  test('an Urdu child name inside an English page is set right-to-left in its own box', () => {
    const html = page(quizData({ played: [{ first: 'عائشہ', roll: 2, correct: 3, total: 4, pct: 75, onList: true }] }));
    expect(html).toMatch(/dir="rtl"[^>]*>عائشہ|dir="rtl">عائشہ/);
  });
});

describe('teacher report page — print', () => {
  test('print hides the action buttons and prints the reminder as text with the children link', () => {
    const html = page(quizData(), { print: true });
    expect(html).toMatch(/@media print|\.act\{display:none/);
    expect(html).toContain(LINK);
    expect(html).not.toContain(`/r/${TOKEN}/remind`);
  });

  test('the printed reminder drops the emoji (the PDF renderer has no emoji font: it would print a box)', () => {
    const body = page(quizData(), { print: true }).replace(/<style>[\s\S]*?<\/style>/, '');
    expect(body).toContain('Our quiz on');
    expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('teacher report page — all my classes tab', () => {
  const cls = {
    cells: [{ grade: '3', subject: 'science', quizzes: 2, played: 15, avg: 70 }, { grade: '5', subject: 'maths', quizzes: 1, played: 0, avg: null }],
    weeks: [{ weekStart: '2026-09-28', quizzes: 2, played: 10, avg: 60 }, { weekStart: '2026-10-05', quizzes: 1, played: 5, avg: 80 }],
    quizzes: [{ id: 'q-9', date: '2026-10-05T09:00:00Z', topic: 'Magnets', grade: '3', subject: 'science', played: 5, avg: 80 }],
  };
  test('grade × subject cards, an 8-week trend of CSS bars, and per-quiz links on minted tokens', () => {
    const html = renderPage({ class: cls }, { lang: 'en', tab: 'class', tokens: { self: TOKEN, quiz: { 'q-9': 'TOK9.sig' } } });
    expect(html).toMatch(/All my classes/);
    expect(html).toMatch(/Class 3/);
    expect(html).toMatch(/Science/);
    expect(html).toMatch(/70%/);
    expect(html).toContain('href="/r/TOK9.sig?lang=en"');
    expect(html).toMatch(/class="[^"]*wk-bar/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/NaN|undefined/);
  });

  test('a cell or week with no average shows a dash, never 0%', () => {
    const html = renderPage({ class: { cells: [{ grade: '5', subject: 'maths', quizzes: 1, played: 0, avg: null }], weeks: [{ weekStart: '2026-10-05', quizzes: 1, played: 0, avg: null }], quizzes: [] } }, { lang: 'en', tab: 'class', tokens: { self: TOKEN } });
    expect(text(html)).not.toMatch(/\b0%/);
  });

  test('empty: says so plainly', () => {
    const html = renderPage({ class: { cells: [], weeks: [], quizzes: [] } }, { lang: 'ur', tab: 'class', tokens: { self: TOKEN } });
    expect(html).toMatch(/dir="rtl"/);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe('teacher report page — reserved lines', () => {
  test('school line only when its data is present', () => {
    expect(text(page(quizData()))).not.toMatch(/School this week/);
    const html = renderPage({ quiz: quizData(), school: { rank: 4, move: 2, played: 31 } }, { lang: 'en', tab: 'quiz', tokens: { self: TOKEN } });
    expect(text(html)).toMatch(/School this week: #4 \(up 2\) · 31 children played/);
  });
});

describe('teacher report page — review follow-ups', () => {
  test('Urdu dates use Latin digits like every other number on the page, and are never wrapped in a left-to-right isolate', () => {
    const html = page(quizData(), { lang: 'ur' });
    expect(html).toMatch(/5 اکتوبر 2026/);
    expect(text(html)).not.toMatch(/[۰-۹]/);
    expect(html).not.toMatch(/class="num">[^<]*اکتوبر/);
    const cls = renderPage({ class: { cells: [], weeks: [], quizzes: [{ id: 'q-9', date: '2026-10-05T09:00:00Z', topic: 'Magnets', played: 5, avg: 80 }] } },
      { lang: 'ur', tab: 'class', tokens: { self: TOKEN, quiz: { 'q-9': 'T9.x' } } });
    expect(cls).toMatch(/5 اکتوبر/);
    expect(cls).not.toMatch(/class="num">[^<]*اکتوبر/);
  });

  test('Urdu chrome says «کوئز», never the Latin word (the /quiz command aside)', () => {
    const pages = [
      page(quizData({ roster: { state: 'ambiguous', className: null, of: null, lists: [{ id: 'a', label: '5-A' }] }, notPlayed: null, played: [], reminder: null }), { lang: 'ur' }),
      renderPage({ class: { cells: [{ grade: '3', subject: 'maths', quizzes: 2, played: 4, avg: 50 }], weeks: [], quizzes: [{ id: 'q', date: '2026-10-05', topic: 'x', played: 1, avg: 1 }] } }, { lang: 'ur', tab: 'class', scope: 'quiz', tokens: { self: TOKEN } }),
      renderPage({ class: { cells: [], weeks: [], quizzes: [] } }, { lang: 'ur', tab: 'class', tokens: { self: TOKEN } }),
      renderMessagePage({ kind: 'missing', lang: 'ur' }),
    ];
    for (const h of pages) expect(text(h).replace(/\/quiz/g, '')).not.toMatch(/\bquiz\b/i);
  });

  test('the Urdu eyebrow says «کوئز رپورٹ»', () => {
    expect(page(quizData(), { lang: 'ur' })).toMatch(/کوئز رپورٹ/);
  });

  test('a child marked "not on list" shows no list number (that number is another list\'s)', () => {
    const html = page(quizData());
    const row = html.slice(html.indexOf('Bilal'), html.indexOf('Bilal') + 400);
    expect(row).toMatch(/not on list/);
    expect(row).not.toMatch(/list no\./);
    const ayesha = html.slice(html.indexOf('id="scores"')).slice(0, 2000);
    expect(text(ayesha)).toMatch(/Ayesha\s*list no\. 2/);
  });
});

describe('teacher report page — the played tile counts the class list only', () => {
  test('a known class: "N of M played" counts on-list children only, the others are named as such', () => {
    const played = [
      { first: 'A', roll: 1, correct: 3, total: 4, pct: 75, onList: true },
      { first: 'B', roll: 2, correct: 3, total: 4, pct: 75, onList: true },
      ...Array.from({ length: 7 }, (_, i) => ({ first: `X${i}`, roll: null, correct: 1, total: 4, pct: 25, onList: false })),
    ];
    const html = page(quizData({ played, summary: { played: 9, of: 4, avg: 40, total: 4, hardestN: 3 } }));
    const tile = text(html.slice(html.indexOf('class="tiles"'), html.indexOf('class="tiles"') + 900));
    expect(tile).toMatch(/2 of 4 played/);
    expect(tile).toMatch(/\+7 not on the list/);
    expect(html).toMatch(/--p:50/);
    expect(tile).not.toMatch(/9 of 4/);
  });
});

describe('message pages', () => {
  test('expired: EN and UR copy telling the teacher to send /quiz', () => {
    expect(renderMessagePage({ kind: 'expired', lang: 'en' })).toMatch(/This link has expired/);
    const ur = renderMessagePage({ kind: 'expired', lang: 'ur' });
    expect(ur).toMatch(/dir="rtl"/);
    expect(text(ur)).toMatch(/\/quiz/);
    // the command is ONE ltr atom, slash included
    expect(ur).toMatch(/<span class="ltr">\/(<span class="ltr">)?quiz/);
    expect(ur).not.toMatch(/<script/i);
  });
  test('missing: a not-found page that says nothing about whose quiz it is', () => {
    expect(renderMessagePage({ kind: 'missing', lang: 'en' })).toMatch(/could not find this report/i);
  });
});
