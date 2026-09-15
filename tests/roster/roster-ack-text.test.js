/**
 * The chat breadcrumb after a /roster Flow closes must say what HAPPENED.
 *
 * It used to say "<class> saved — N students on the roster" for every completion,
 * including an edit and an untouched view. With the hand-over (teacher_set) it
 * would have told a coach who just named a class teacher that a roster was
 * saved — a wrong sentence in the one place she can scroll back to. The sentence
 * is now keyed off roster_action, and every value the endpoint emits has one.
 */
const fs = require('fs');
const path = require('path');
const { rosterAckText, ROSTER_ACTIONS } = require('../../bot/shared/utils/roster-ack');

const ROOT = path.resolve(__dirname, '../..');

describe('rosterAckText', () => {
  it('a save still reads as a save', () => {
    expect(rosterAckText({ roster_action: 'saved', roster_class: 'Grade 3-A', roster_count: '16' }))
      .toMatch(/Grade 3-A saved — 16 students on the roster/);
  });

  it('a hand-over says the class teacher was set, not that a roster was saved', () => {
    const t = rosterAckText({ roster_action: 'teacher_set', roster_class: 'Grade 3-B', roster_count: '48' });
    expect(t).toMatch(/Grade 3-B/);
    expect(t).toMatch(/class teacher/i);
    expect(t).not.toMatch(/saved/);
  });

  it('an edit and an unchanged close each get their own sentence', () => {
    expect(rosterAckText({ roster_action: 'edited', roster_class: 'Grade 1-A', roster_count: '30' })).toMatch(/updated/);
    expect(rosterAckText({ roster_action: 'unchanged', roster_class: 'Grade 1-A', roster_count: '30' })).toMatch(/[Nn]othing.*changed/);
  });

  it('an unknown or missing action falls back to the old sentence rather than crashing', () => {
    expect(rosterAckText({ roster_class: 'Grade 2-C' })).toMatch(/Grade 2-C saved/);
    expect(rosterAckText({})).toMatch(/That class saved/);
  });

  it('every roster_action the endpoint emits has a sentence', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot/shared/routes/roster-flow-endpoint.js'), 'utf8');
    const emitted = [...new Set([...src.matchAll(/roster_action:\s*'([a-z_]+)'/g)].map((m) => m[1]))];
    expect(emitted.length).toBeGreaterThan(0);
    for (const a of emitted) expect(ROSTER_ACTIONS).toContain(a);
  });

  it('the bot ack branch actually calls it', () => {
    const bot = fs.readFileSync(path.join(ROOT, 'bot/whatsapp-bot.js'), 'utf8');
    const start = bot.indexOf("flowType === 'roster'");
    const branch = bot.slice(start, bot.indexOf('} else if (flowType ===', start + 1));
    expect(branch).toMatch(/rosterAckText\(responseJson\)/);
  });
});
