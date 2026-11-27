'use strict';
/**
 * English letter-sound picker: j replaces d (the content owner, 27 Nov 2026: d was one of the sounds that did not match in
 * her listening check). The j row keeps d's slot and d's cards, with d -> j: [b, p, q, t, j]. Jugnu says "ja" three times,
 * the take she picked (B), at its text's key (sa/v5/en/sha1('en|ja')[:12]); its sha256 is written in base64 so no hex
 * digest reads as a phone number to the fixture rule. d's own prompt ("da") is named by no battery any more, so its clip
 * and its timings row are gone. Behind sa_r28_letter_pick like the rest of the picker: with the switch OFF the battery is
 * served as before (sa-r28-off-identity).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const REPO = path.join(__dirname, '..', '..');
const DASH = path.join(REPO, 'dashboard');
const DATA = path.join(REPO, 'bot', 'shared', 'data', 'child-test', 'sa');
const PAGES = [1, 2, 3, 4, 5].flatMap((g) => ['ur', 'en'].map((page) => `sa.coach.G${g}.A.${page}.json`));
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
const names = Object.keys(SWITCHES);
const earlier = Object.fromEntries(names.map((k) => [k, !/^r28/.test(k)]));
const ON = { ...earlier, r28LetterPick: true };
const pick = (served) => served.tasks.find((t) => t.id === 'en.letter_pick10');

const J_KEY = 'sa/v5/en/5b692ca8b35c.mp3';
const J_SHA256 = 'en9B6zqxfxneqXGtsQLpETucECWeqmK8TVoOsyFglbw='; // take B
const J_TIMINGS = { speech_start_ms: 310, speech_end_ms: 1760, dur_ms: 1889, first_end_ms: 454,
  speech_spans_ms: [[310, 454], [963, 1107], [1616, 1760]] };
const D_KEY = 'sa/v5/en/7f1a59d218ac.mp3'; // sha1('en|da')[:12], d's prompt before
const TIMINGS = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'v5', 'prompt_timings.json'), 'utf8'));
const LOCK = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'clips.lock.json'), 'utf8'));

describe('English letter-sound picker: j in d\'s place', () => {
  test.each(PAGES)('%s, switch ON: the fifth row is j, with d\'s cards (d -> j), and no row is d', (name) => {
    const t = pick(applySwitches(read(name), ON));
    expect(t.items.map((it) => it.target)).toEqual(['g', 'w', 'q', 'x', 'j', 'f', 'b', 'a', 'p', 'o']);
    const j = t.items[4];
    expect([j.id, j.show, j.target, j.options, j.prompt_text, j.prompt_audio])
      .toEqual(['en.letter_pick10.05', 'j', 'j', ['b', 'p', 'q', 't', 'j'], 'ja', J_KEY]);
    expect(t.items.filter((it) => it.target === 'd')).toEqual([]);
  });

  test('j\'s prompt is take B, timed on its own file', () => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(DASH, J_KEY))).digest('base64')).toBe(J_SHA256);
    expect(TIMINGS[J_KEY]).toEqual(J_TIMINGS);
    expect(LOCK.files[`dashboard/${J_KEY}`]).toBeTruthy();
  });

  test('d\'s retired prompt is named by no battery, and its clip, timings row and lock entry are gone', () => {
    for (const name of fs.readdirSync(DATA).filter((n) => /^sa\..+\.json$/.test(n))) {
      expect([name, fs.readFileSync(path.join(DATA, name), 'utf8').includes(D_KEY)]).toEqual([name, false]);
    }
    expect(fs.existsSync(path.join(DASH, D_KEY))).toBe(false);
    expect(TIMINGS[D_KEY]).toBeUndefined();
    expect(LOCK.files[`dashboard/${D_KEY}`]).toBeUndefined();
  });

  test.each(PAGES)('%s, switch OFF: no picker is served (the say-aloud letter sounds as before)', (name) => {
    const served = applySwitches(read(name), earlier);
    expect(served.tasks.some((t) => t.id === 'en.letter_pick10')).toBe(false);
    expect(JSON.stringify(served)).not.toContain(J_KEY);
  });
});
