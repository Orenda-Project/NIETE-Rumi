'use strict';
// bd-rj6w0n.14.16.6 — the v10 card written on request: the same rules the 838 GB cards were written with
// (brief + exit/goal + home/turn + GB rules, Urdu rules for Urdu), one repair round fed the gate's reasons,
// and a deadline so a slow model never holds the teacher past ICT's time.
const { systemPrompt, userPrompt, authorCard } = require('../../shared/services/lp-v10-card/author');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: {} });
const clientOf = (...replies) => {
  const calls = [];
  return { calls, chat: { completions: { create: async (req) => { calls.push(req); return replies.shift()(req); } } } };
};
const base = { v9Html: '<html>v9</html>', moves: { moves: [{ move_id: 'm1' }] }, stem: 'g3_ch1_Maths_seg1', subject: 'Maths', lang: 'en' };

describe('lp-v10-card author', () => {
  test('system prompt carries the brief, the two editing passes, the GB rules and the right example', () => {
    const maths = systemPrompt({ subject: 'Maths', lang: 'en' });
    expect(maths).toMatch(/v10 card author brief/);
    expect(maths).toMatch(/What the judge needs/);
    expect(maths).toMatch(/Home link \(judge 6C/);
    expect(maths).toMatch(/Gilgit-Baltistan/);
    expect(maths).toMatch(/"subject": "Maths"/);
    expect(maths).not.toMatch(/## Check your own card/); // offline tool steps never reach the model
    expect(maths).not.toMatch(/Urdu rules on top/);
    const urdu = systemPrompt({ subject: 'Urdu', lang: 'ur' });
    expect(urdu).toMatch(/Urdu rules on top of the brief/);
    expect(urdu).toMatch(/"subject": "English"/); // Urdu copies the English example's shape
  });

  test('user prompt names the stem and carries v9 and the moves', () => {
    const u = userPrompt(base);
    expect(u).toMatch(/g3_ch1_Maths_seg1/);
    expect(u).toMatch(/<html>v9<\/html>/);
    expect(u).toMatch(/"move_id":"m1"/);
  });

  test('a card that passes the gate on the first try is returned after one call', async () => {
    const client = clientOf(() => reply({ header: { title: 'T' } }));
    const out = await authorCard({ ...base, client, model: 'm', validate: () => [] });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({ model: 'm', job: 'lp.v10card' });
    expect(out.card).toMatchObject({ header: { title: 'T' }, v9_html: 'g3_ch1_Maths_seg1.v9.html' });
    expect(out.rounds).toBe(1);
  });

  test('a refused card gets one repair round carrying the reasons', async () => {
    const client = clientOf(() => reply({ v: 1 }), () => reply({ v: 2 }));
    const validate = (c) => (c.v === 1 ? ['we: needs ONE NEIGHBOUR TURN'] : []);
    const out = await authorCard({ ...base, client, model: 'm', validate });
    expect(client.calls).toHaveLength(2);
    const last = client.calls[1].messages.at(-1).content;
    expect(last).toMatch(/we: needs ONE NEIGHBOUR TURN/);
    expect(out.card.v).toBe(2);
    expect(out.rounds).toBe(2);
  });

  test('still refused after the repair round is an error with the reasons', async () => {
    const client = clientOf(() => reply({}), () => reply({}));
    await expect(authorCard({ ...base, client, model: 'm', validate: () => ['too long'] }))
      .rejects.toMatchObject({ code: 'card_refused', reasons: ['too long'] });
  });

  test('the deadline stops a slow model', async () => {
    const client = clientOf(() => new Promise(() => {}));
    await expect(authorCard({ ...base, client, model: 'm', validate: () => [], deadlineMs: 20 }))
      .rejects.toMatchObject({ code: 'card_timeout' });
  });
});
