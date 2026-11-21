'use strict';
/**
 * Turning one governed answer into WhatsApp messages. The disclosures come from the tool results, as
 * the data team's formatting.disclosures does (a surface must add them itself: their answering.py ⚠️),
 * so a truncation or a policy note cannot go missing however the model wrote its prose.
 */

const F = require('../../bot/shared/services/data-analyst/whatsapp-format');

const rules = (v = 'v0.42.5') => ({ name: 'get_rules', arguments: { region: 'niete-rumi', domain: 'lesson_plans' }, result: JSON.stringify({ rule_version: v, rule_files: [{ path: 'p' }] }) });
const metric = (args, payload) => ({ name: 'query_metric', arguments: args, result: JSON.stringify({ status: 'ok', rows: [], total_rows: 0, ...payload }) });
const query = (sql, payload) => ({ name: 'execute_query', arguments: { sql }, result: JSON.stringify({ status: 'ok', rows: [], total_rows: 0, ...payload }) });

describe('NEXT and ASK lines', () => {
  test('the NEXT line becomes up to three numbered follow-ups', () => {
    const text = 'Headline.\n\n• one\n\nNEXT: [analyze] Which sectors lag? | [detect] Who stopped? | [predict] Where does it land?';
    const { body, next } = F.splitNext(text);
    expect(body).toBe('Headline.\n\n• one');
    expect(next).toEqual([
      { kind: 'analyze', question: 'Which sectors lag?' },
      { kind: 'detect', question: 'Who stopped?' },
      { kind: 'predict', question: 'Where does it land?' },
    ]);
  });
  test('the kind is read in every form a model writes it, never left in the question', () => {
    const t = 'Body.\n\nNEXT: analyze Does it differ by group? | (detect) Which schools lag? | predict: When does it catch up? | **investigate** Why did it fall?';
    expect(F.splitNext(t).next).toEqual([
      { kind: 'analyze', question: 'Does it differ by group?' },
      { kind: 'detect', question: 'Which schools lag?' },
      { kind: 'predict', question: 'When does it catch up?' },
      { kind: 'investigate', question: 'Why did it fall?' },
    ]);
  });
  test('a question that merely starts with a word like "Detected" keeps it', () => {
    expect(F.splitNext('B.\n\nNEXT: Detected gaps by sector?').next).toEqual([{ kind: '', question: 'Detected gaps by sector?' }]);
  });
  test('a sentence that merely says "next:" mid-answer is kept', () => {
    const t = 'Next: we looked at sectors.\nThen the total.';
    expect(F.splitNext(t)).toEqual({ body: t, next: [] });
  });
  test('ASK lines with two or more options become a question and its options', () => {
    const { body, asks } = F.splitAsks('"Active" can mean two things.\nASK: Which active? | Used the assistant | Made a lesson plan');
    expect(body).toBe('"Active" can mean two things.');
    expect(asks).toEqual([{ question: 'Which active?', options: ['Used the assistant', 'Made a lesson plan'] }]);
  });
});

describe('WhatsApp text', () => {
  test('double asterisks become WhatsApp bold; headings become a bold line', () => {
    expect(F.toWhatsApp('**736 teachers** made a plan')).toBe('*736 teachers* made a plan');
    expect(F.toWhatsApp('## Lesson plans\nbody')).toBe('*Lesson plans*\nbody');
  });
  test('a link the model composed is removed; one a tool returned is kept as plain text', () => {
    const known = new Set(['https://files.example/a.csv']);
    expect(F.toWhatsApp('See <https://made.up/x|the file> now', known)).toBe('See the file now');
    expect(F.toWhatsApp('See [the file](https://made.up/x)', known)).toBe('See the file');
    expect(F.toWhatsApp('See <https://files.example/a.csv|the file>', known)).toBe('See the file: https://files.example/a.csv');
  });
  test('a table row is not sent as rubble', () => {
    expect(F.toWhatsApp('| a | b |\n|---|---|\n| 1 | 2 |\nafter')).toBe('after');
  });
});

describe('disclosures (from the payloads, never the prose)', () => {
  test('truncation, a LIMIT, a policy note word for word, governance warnings and notes', () => {
    const calls = [
      query('SELECT 1', { truncated: true, total_rows: 3419, rows_shown: 100 }),
      query('SELECT 2', { sql_limit: 500 }),
      query('SELECT 3', { policy: { must_disclose: true, note: 'Two columns were withheld under the serving policy.' } }),
      query('SELECT 4', { governance_warnings: ['test accounts excluded'] }),
      metric({ metric: 'lp_users' }, { notes: ['November is not over yet.'] }),
    ];
    const notes = F.disclosures(calls);
    expect(notes).toEqual([
      // No CSV on WhatsApp, so the offer is the narrower question, never a download.
      '⚠️ Showing the first 100 of 3,419 rows (preview). Ask for a narrower breakdown or filter to see the rest.',
      '⚠️ This query was capped by a LIMIT of 500 — not the complete dataset.',
      '🔒 Two columns were withheld under the serving policy.',
      '⚠️ Data rule: test accounts excluded',
      'November is not over yet.',
    ]);
  });
  test('the same notice from two queries is said once', () => {
    const w = { governance_warnings: ['x'] };
    expect(F.disclosures([query('a', w), query('b', w)])).toEqual(['⚠️ Data rule: x']);
  });
  test('identifier columns served across queries become one line', () => {
    const p = (cols) => ({ policy: { must_disclose: true, note: 'n', identifiers_served: cols } });
    expect(F.disclosures([query('a', p(['first_name'])), query('b', p(['first_name', 'school_name']))]))
      .toEqual(['🔒 contains personal identifiers (first_name, school_name) — internal use only, do not share outside Taleemabad']);
  });
  test('a POLICY_BLOCKED compiled answer says why there is no figure', () => {
    const c = { name: 'query_metric', arguments: {}, result: JSON.stringify({ error_class: 'POLICY_BLOCKED', message: 'This list would show a phone.' }) };
    expect(F.disclosures([c])).toEqual(['🔒 This list would show a phone.']);
  });
});

describe('footer', () => {
  test('source, the window the queries asked about, and the rules version get_rules reported', () => {
    const calls = [rules(), metric({ metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13' }, {})];
    expect(F.footer(calls)).toBe('_NIETE data · 7–13 Nov 2026 · rules v0.42.5_');
  });
  test('a window across months and years, and SQL date literals', () => {
    expect(F.footer([rules(), query("WHERE d BETWEEN '2026-10-28' AND '2026-11-03'", {})])).toBe('_NIETE data · 28 Oct – 3 Nov 2026 · rules v0.42.5_');
    expect(F.footer([rules(), query("WHERE d BETWEEN '2025-12-28' AND '2026-01-03'", {})])).toBe('_NIETE data · 28 Dec 2025 – 3 Jan 2026 · rules v0.42.5_');
  });
  test('a strict "<" end date is exclusive, and nothing runs past today', () => {
    // Live trial 20 Nov: `created_at < '2026-11-21'` showed "– 21 Nov", a day that had not happened yet.
    const sql = "WHERE created_at >= '2026-11-01' AND created_at < '2026-11-21'";
    expect(F.footer([rules(), query(sql, {})], { today: '2026-11-20' })).toBe('_NIETE data · 1–20 Nov 2026 · rules v0.42.5_');
    const oct = "WHERE d >= DATE '2026-10-01' AND d < DATE '2026-11-01'";
    expect(F.footer([rules(), query(oct, {})], { today: '2026-11-20' })).toBe('_NIETE data · 1–31 Oct 2026 · rules v0.42.5_');
    expect(F.footer([rules(), query("WHERE d <= '2026-11-20'", {})], { today: '2026-11-20' })).toBe('_NIETE data · 20 Nov 2026 · rules v0.42.5_');
    expect(F.footer([rules(), metric({ metric: 'm', from_date: '2026-11-01', to_date: '2026-11-30' }, {})], { today: '2026-11-20' }))
      .toBe('_NIETE data · 1–20 Nov 2026 · rules v0.42.5_');
  });
  test('no query, no footer (a clarifying question or a refusal)', () => {
    expect(F.footer([rules()])).toBe('');
    expect(F.footer([])).toBe('');
  });
});

describe('renderAnswer', () => {
  const calls = [rules(), metric({ metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13' }, {})];

  test('answer, disclosures, footer, then numbered follow-ups that a reply of 1-3 can pick', () => {
    const out = F.renderAnswer({
      text: '**736 teachers** made a plan.\n\nNEXT: [analyze] Which sectors lag? | [detect] Who stopped?',
      calls,
    });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toBe([
      '*736 teachers* made a plan.',
      '',
      '_NIETE data · 7–13 Nov 2026 · rules v0.42.5_',
      '',
      'Ask next (reply with a number):',
      '1. Which sectors lag?',
      '2. Who stopped?',
    ].join('\n'));
    expect(out.choices).toEqual(['Which sectors lag?', 'Who stopped?']);
  });

  test('a clarifying question numbers its options instead, and has no follow-ups', () => {
    const out = F.renderAnswer({ text: '"Active" can mean two things.\nASK: Which active? | Used the assistant | Made a lesson plan', calls: [rules()] });
    expect(out.messages[0]).toBe('"Active" can mean two things.\n\n*Which active?*\n1. Used the assistant\n2. Made a lesson plan');
    expect(out.choices).toEqual(['Which active: Used the assistant', 'Which active: Made a lesson plan']);
  });

  test('stopped early says so on top', () => {
    const out = F.renderAnswer({ text: 'partial', calls, stoppedEarly: true });
    expect(out.messages[0].startsWith('⚠️ This answer is incomplete')).toBe(true);
  });

  test('a long answer is split under WhatsApp\'s 4,096 limit, at a paragraph', () => {
    const para = 'x'.repeat(3000);
    const out = F.renderAnswer({ text: `${para}\n\n${para}`, calls });
    expect(out.messages.length).toBe(2);
    for (const m of out.messages) expect(m.length).toBeLessThanOrEqual(4096);
  });
});

describe('composeReply (round 2: a chart and one or two lines, or text, never numbered replies)', () => {
  const calls = [rules(), metric({ metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13' }, { notes: ['November is not over yet.'] })];
  test('with a chart: the headline and one more line, the disclosures, the footer; under 1,024', () => {
    const r = F.composeReply({ text: '**1,816 teachers** got a plan.\nUp from 1,700.\n\n• bullet one\n• bullet two\n\nNEXT: [analyze] a | [detect] b', calls, hasChart: true });
    expect(r.caption).toBe('*1,816 teachers* got a plan.\nUp from 1,700.\n\nNovember is not over yet.\n\n_NIETE data · 7–13 Nov 2026 · rules v0.42.5_');
    expect(r.asks).toEqual([]);
  });
  test('without a chart: the whole answer, bullets and all', () => {
    const r = F.composeReply({ text: '*1,816* got a plan.\n\n• a\n• b', calls, hasChart: false });
    expect(r.caption).toContain('• a\n• b');
  });
  test('an answer too long for one bubble is split: the text first, a short body for the buttons', () => {
    const long = `Headline.\n\n${'word '.repeat(400)}`;
    const r = F.composeReply({ text: long, calls, hasChart: false });
    expect(r.caption.length).toBeLessThanOrEqual(1024);
    expect(r.before.length).toBeGreaterThan(0);
  });
  test('a clarifying question: its options, no chart caption needed', () => {
    const r = F.composeReply({ text: '"Active" can mean two things.\nASK: Which active? | Used the assistant | Made a lesson plan', calls: [rules()], hasChart: false });
    expect(r.asks).toEqual([{ question: 'Which active?', options: ['Used the assistant', 'Made a lesson plan'] }]);
    expect(r.caption).toBe('"Active" can mean two things.');
  });
});

test('beside a chart, a list label ("By sector:") is not one of the two lines', () => {
  const calls = [rules(), metric({ metric: 'lp_users', from_date: '2026-11-14', to_date: '2026-11-20' }, {})];
  const r = F.composeReply({ text: '1,989 of 6,354 teachers got a plan.\n\nBy sector:\n• Urban-I 485 • B.K 468\n\nUrban-I and B.K lead.', calls, hasChart: true });
  expect(r.caption.split('\n\n')[0]).toBe('1,989 of 6,354 teachers got a plan.\nUrban-I and B.K lead.');
});

describe('composeReply: the measures the chart leaves out go under it (bd-bhgw20.4)', () => {
  test('beside a chart: the headline, then the listed lines, then the footer; the model\'s own bullets still go', () => {
    const r = F.composeReply({
      text: '*1,135 coach visits* were held 1–21 Nov.\n• B.K: 229\n• Nilore: 131',
      hasChart: true,
      rest: ['B.K: 217 reviewed · 212 complete', 'Nilore: 127 reviewed · 122 complete'],
    });
    const lines = r.caption.split('\n').filter(Boolean);
    expect(lines[0]).toBe('*1,135 coach visits* were held 1–21 Nov.');
    expect(r.caption).toContain('B.K: 217 reviewed · 212 complete\nNilore: 127 reviewed · 122 complete');
    expect(r.caption).not.toContain('• B.K: 229');
  });
  test('without a chart: the model\'s text stays whole and every listed row follows it', () => {
    const r = F.composeReply({ text: 'Visits.\n• Urban-I leads.', hasChart: false, rest: ['B.K: 229', 'Nilore: 131'] });
    expect(r.caption).toContain('Visits.\n• Urban-I leads.\n\nB.K: 229\nNilore: 131');
  });
});
