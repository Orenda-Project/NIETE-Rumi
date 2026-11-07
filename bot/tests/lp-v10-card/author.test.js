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

  // Sandbox 2026-11-07: a real v9 page is ~1.8 MB, nearly all base64 fonts (~600k tokens), and the provider
  // refused every card with a 400. The model gets the lesson without the embedded bytes.
  test('user prompt leaves out the fonts and images embedded in v9', () => {
    const font = `@font-face{src:url(data:font/woff2;base64,${'A'.repeat(5000)}) format('woff2');}`;
    const img = `<img src="data:image/png;base64,${'B'.repeat(5000)}=">`;
    const u = userPrompt({ ...base, v9Html: `<style>${font}</style><p>Count to ten</p>${img}` });
    expect(u).toMatch(/Count to ten/);
    expect(u).not.toMatch(/base64/);
    expect(u.length).toBeLessThan(1000);
  });

  test('a card that passes the gate on the first try is returned after one call', async () => {
    const client = clientOf(() => reply({ header: { title: 'T' } }));
    const out = await authorCard({ ...base, client, model: 'm', validate: () => [] });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({ model: 'm', job: 'lp.v10card' });
    // Sandbox 7 Nov: with thinking on, Sonnet 5 spent all 12,000 output tokens reasoning on a real lesson and
    // returned an empty card both rounds ("not JSON ... position 0"). Off, as ICT's author has it.
    expect(client.calls[0].reasoning).toEqual({ enabled: false });
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

  // Sandbox 2026-11-07: every on-request card was refused in round 1 and timed out in round 2, and the reasons
  // were lost with the timeout. Each refusal is reported as it happens.
  test('each refused round is reported with its reasons, even when the deadline fires after it', async () => {
    const refused = [];
    const client = clientOf(() => reply({ v: 1 }), () => new Promise(() => {}));
    await expect(authorCard({ ...base, client, model: 'm', validate: () => ['we: needs ONE NEIGHBOUR TURN'],
      deadlineMs: 50, onRefused: (r) => refused.push(r) })).rejects.toMatchObject({ code: 'card_timeout' });
    expect(refused).toEqual([{ round: 1, reasons: ['we: needs ONE NEIGHBOUR TURN'] }]);
  });

  // Sandbox 7 Nov, thinking off: both live cards came back in ~20 s a round and were refused only on a move a few
  // characters over 70 after round 2. The deadline, not a round count of two, is what bounds the teacher's wait.
  test('repair rounds go on to four while the deadline allows', async () => {
    const client = clientOf(() => reply({ v: 1 }), () => reply({ v: 2 }), () => reply({ v: 3 }), () => reply({ v: 4 }));
    const out = await authorCard({ ...base, client, model: 'm', validate: (c) => (c.v < 4 ? ['move 6: do is 74 characters'] : []) });
    expect(client.calls).toHaveLength(4);
    expect(out.rounds).toBe(4);
  });

  // Amena, 7 Nov: "v10 embedded with v9 — make it happen for GB". A card the gates still query after the last
  // round goes out (the one with fewest reasons) and the reasons are reported; only no card at all is an error.
  test('still queried after the last round: the closest card is sent, with its reasons', async () => {
    const client = clientOf(() => reply({ v: 1 }), () => reply({ v: 2 }), () => ({ choices: [{ message: { content: '' } }] }), () => reply({ v: 4 }));
    const validate = (c) => (c.v === 2 ? ['move 7: do is 81 characters'] : ['a', 'b']);
    const out = await authorCard({ ...base, client, model: 'm', validate });
    expect(out.card.v).toBe(2);
    expect(out.reasons).toEqual(['move 7: do is 81 characters']);
  });

  // Sandbox 7 Nov, G3 Maths c04 s004: round 2's card had a field missing, the gates threw "reading 'forEach'" and
  // the throw ended the job with v9 alone. A card that cannot be checked is a refusal fed back, never the card sent.
  test('a card the gates cannot check is refused with the error and the rounds go on', async () => {
    const client = clientOf(() => reply({ v: 1 }), () => reply({ v: 2 }));
    const validate = (c) => { if (c.v === 1) throw new TypeError("Cannot read properties of undefined (reading 'forEach')"); return []; };
    const out = await authorCard({ ...base, client, model: 'm', validate });
    expect(client.calls[1].messages.at(-1).content).toMatch(/reading 'forEach'/);
    expect(out.card.v).toBe(2);
  });

  test('a card the gates cannot check is never the one sent', async () => {
    const client = clientOf(() => reply({ v: 1 }), () => reply({ v: 2 }), () => reply({ v: 3 }), () => reply({ v: 4 }));
    const validate = (c) => { if (c.v === 1) throw new TypeError('boom'); return ['a', 'b']; };
    const out = await authorCard({ ...base, client, model: 'm', validate });
    expect(out.card.v).not.toBe(1);
  });

  test('no card at all after the last round is an error with the reasons', async () => {
    const empty = () => ({ choices: [{ message: { content: '' } }] });
    const client = clientOf(empty, empty, empty, empty);
    await expect(authorCard({ ...base, client, model: 'm', validate: () => [] }))
      .rejects.toMatchObject({ code: 'card_refused' });
  });

  test('the deadline stops a slow model', async () => {
    const client = clientOf(() => new Promise(() => {}));
    await expect(authorCard({ ...base, client, model: 'm', validate: () => [], deadlineMs: 20 }))
      .rejects.toMatchObject({ code: 'card_timeout' });
  });
});
