/**
 * Round 28: the letter-sound picker reads each prompt's speech end from sa/v5/prompt_timings.json (sa-ui.js), so the
 * tap clock starts when the sound ends. A phone that prepared its visit offline must hold that file too, in the session
 * cache beside the clips it describes (renewed with them on a SESSION bump), never only in the engine cache.
 */
const { prepVisit, timingUrls } = require('../sa/sa-offline');

describe('sa/v5/prompt_timings.json goes on the phone with the v5 clips', () => {
  test('timingUrls: one prompt_timings.json beside the v5 clips, once, with the v4 word timings', () => {
    expect(timingUrls(['/sa/v5/ur/aaa111.mp3', '/sa/v4/ur/bbb222.mp3', '/sa/v5/en/ccc333.mp3']))
      .toEqual(['/sa/v4/ur/bbb222.json', '/sa/v5/prompt_timings.json']);
  });
  test('timingUrls: no v5 clip, no prompt_timings.json', () => {
    expect(timingUrls(['/sa/v4/ur/bbb222.mp3', '/sa/v1/ur/ddd444.mp3'])).toEqual(['/sa/v4/ur/bbb222.json']);
  });
  test('timingUrls: the file sits under the same base as the clips', () => {
    expect(timingUrls(['https://x.test/sa/v5/ur/aaa111.mp3'])).toEqual(['https://x.test/sa/v5/prompt_timings.json']);
  });
  test('prepVisit asks for it after the clips; a battery with a picker prompt gets it', async () => {
    const B = { tasks: [{ id: 'ur.letter_pick10', items: [{ id: 'ur.letter_pick10.01', prompt_audio: 'sa/v5/ur/aaa111.mp3' }] }] };
    const msgs = [];
    const ask = async (m) => { msgs.push(m); return { ok: true, cached: m.urls.length, missing: [], bytes: 0 }; };
    const r = await prepVisit({ forms: ['sa.coach.G3.A.ur'], ask, readBattery: async () => B });
    const asked = msgs.map((m) => m.urls).reduce((a, u) => a.concat(u), []);
    expect(asked).toContain('/sa/v5/prompt_timings.json');
    expect(msgs[msgs.length - 1].urls).toEqual(['/sa/v5/prompt_timings.json']);
    expect(r.ok).toBe(true);
  });
});
