'use strict';
/**
 * The read-along build's money cap: every paid call is checked against a running total before it is made and logged
 * after; past the cap the build stops with the total in the message and one `web_quiz.readalong_spend_cap` event. The
 * same cap, per page per hour, is what the server's first-open voicing uses.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Tm = require('../../../shared/services/quiz/web-quiz-readalong-timing');
const Build = require('../../../../scripts/web-quiz/readalong-build');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ra-cap-')), 'spend.jsonl');
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);

describe('the build script: --max-usd', () => {
  test('a fake provider at US$0.50 a call under a US$2.00 cap: four calls go, the fifth throws before it is made, four lines written', async () => {
    const file = tmpFile();
    const events = [];
    const sp = Build.makeSpender({ file, lane: 'test', maxUsd: 2, onCap: (e) => events.push(e) });
    let made = 0;
    const fakeCall = async () => { sp.guard(0.5); made += 1; sp.spend('fake', 'readalong tts', 1, 0.5); };
    for (let k = 0; k < 4; k += 1) await fakeCall();
    await expect(fakeCall()).rejects.toThrow(/US\$2\.00/);
    expect(made).toBe(4);
    expect(lines(file)).toHaveLength(4);
    expect(JSON.parse(lines(file)[0])).toMatchObject({ lane: 'test', provider: 'fake', what: 'readalong tts', units: 1, usd: 0.5 });
    expect(events).toEqual([expect.objectContaining({ event: 'web_quiz.readalong_spend_cap', total_usd: 2, max_usd: 2 })]);
    await expect(fakeCall()).rejects.toThrow(/cap/);
    expect(events).toHaveLength(1);   // one event, however often it is hit
  });

  test('a call that lands past the cap is still logged (the money is spent), then the build stops with the total', () => {
    const file = tmpFile();
    const sp = Build.makeSpender({ file, lane: 'test', maxUsd: 1, onCap: () => {} });
    sp.spend('fake', 'x', 1, 0.75);
    expect(() => sp.spend('fake', 'x', 1, 0.5)).toThrow(/US\$1\.25/);
    expect(lines(file)).toHaveLength(2);
  });

  test('the default cap is US$2.00, and --max-usd reads as a number', () => {
    expect(Build.DEFAULT_MAX_USD).toBe(2);
    expect(Build.makeSpender({ file: null, maxUsd: undefined }).max).toBe(2);
    expect(Build.args(['node', 'x', '--out', 'o', '--max-usd', '0.4'])['max-usd']).toBe('0.4');
    expect(Build.makeSpender({ file: null, maxUsd: '0.4' }).max).toBe(0.4);
  });
});

describe('the cap for a server that voices a page on its first open (per page, per hour)', () => {
  test('US$0.05 a page an hour: the third US$0.02 call on one page throws, another page is untouched, an hour later it may go again', () => {
    let now = 1e12;
    const events = [];
    const cap = Tm.pageHourCap({ maxUsd: 0.05, now: () => now, onCap: (e) => events.push(e) });
    cap.charge('book1/p3', 0.02);
    cap.charge('book1/p3', 0.02);
    expect(() => cap.charge('book1/p3', 0.02)).toThrow(/book1\/p3.*US\$0\.04/);
    expect(() => cap.charge('book1/p3', 0.02)).toThrow(/cap/);
    expect(events).toEqual([expect.objectContaining({ event: 'web_quiz.readalong_spend_cap', key: 'book1/p3', total_usd: 0.04, max_usd: 0.05 })]);
    expect(() => cap.charge('book1/p4', 0.02)).not.toThrow();
    now += 3600 * 1000 + 1;
    expect(() => cap.charge('book1/p3', 0.02)).not.toThrow();
  });

  test('the shared running-total cap the script is built on', () => {
    const c = Tm.spendCap({ maxUsd: 1 });
    c.check(0.6); c.add(0.6);
    expect(c.total()).toBeCloseTo(0.6);
    expect(() => c.check(0.5)).toThrow(/US\$0\.60.*US\$1\.00/);
    expect(Tm.DEFAULT_PAGE_HOUR_USD).toBe(0.05);
  });
});
