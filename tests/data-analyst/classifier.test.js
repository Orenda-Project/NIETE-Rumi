'use strict';
/**
 * No data mode (the operator, 21 Nov): for someone on the switch, a message that looks like a data
 * question goes straight to the analyst. The bot's own words never go there; a cheap model decides
 * the rest; when it is unsure the person is asked with two buttons. A failure is "normal": the
 * ordinary bot answers, as it always did.
 */

const { isClearlyNormal, classify, VERDICTS } = require('../../bot/shared/services/data-analyst/classifier');

function fakeClient(reply) {
  const requests = [];
  return {
    requests,
    messages: {
      async create(req) {
        requests.push(req);
        if (reply instanceof Error) throw reply;
        return { content: [{ type: 'text', text: reply }], usage: { input_tokens: 50, output_tokens: 1 } };
      },
    },
  };
}

describe('isClearlyNormal: the bot\'s own words never reach the analyst', () => {
  test.each(['menu', 'Menu', 'hi', 'Assalam o Alaikum', '/observe', '/lp grade 3', 'lesson plan', 'observe',
    'training', 'quiz', 'yes', 'ok', '2', 'thanks', 'help', ''])('%p', (t) => {
    expect(isClearlyNormal(t)).toBe(true);
  });
  test.each(['How many teachers made a lesson plan last week?', 'coach visits by sector this month',
    'Are FICO scores improving since September?', 'and by sector?'])('%p is not decided here', (t) => {
    expect(isClearlyNormal(t)).toBe(false);
  });
});

describe('classify', () => {
  test('the model\'s one word decides, case and punctuation aside', async () => {
    for (const [reply, want] of [['DATA', 'data'], ['data.', 'data'], ['NORMAL', 'normal'], ['Unsure', 'unsure']]) {
      await expect(classify('How many teachers made a lesson plan?', { client: fakeClient(reply) })).resolves.toBe(want);
    }
  });
  test('anything else, or a failure, is normal (the ordinary bot answers)', async () => {
    await expect(classify('x y z', { client: fakeClient('maybe?') })).resolves.toBe('normal');
    await expect(classify('x y z', { client: fakeClient(new Error('429')) })).resolves.toBe('normal');
  });
  test('clearly normal words never cost a model call', async () => {
    const client = fakeClient('DATA');
    await expect(classify('menu', { client })).resolves.toBe('normal');
    expect(client.requests).toHaveLength(0);
  });
  test('a cheap call: a small model, a one-word answer, the recent data answer as context', async () => {
    const client = fakeClient('DATA');
    await classify('and by sector?', { client, model: 'claude-haiku-4-5', recentAnswer: 'Teachers who got a lesson plan last week: 1,816.' });
    const req = client.requests[0];
    expect(req.model).toBe('claude-haiku-4-5');
    expect(req.max_tokens).toBeLessThanOrEqual(5);
    expect(JSON.stringify(req.messages)).toContain('Teachers who got a lesson plan last week');
    expect(JSON.stringify(req.messages)).toContain('and by sector?');
  });
  test('the three verdicts', () => {
    expect(VERDICTS).toEqual(['data', 'normal', 'unsure']);
  });
});

test('a short follow-up right after a data answer is asked of the model; the bot\'s own words still are not', async () => {
  const client = fakeClient('DATA');
  await expect(classify('by sector?', { client, recentAnswer: '1,816 teachers got a plan.' })).resolves.toBe('data');
  await expect(classify('menu', { client, recentAnswer: '1,816 teachers got a plan.' })).resolves.toBe('normal');
  await expect(classify('by sector?', { client })).resolves.toBe('normal');
  expect(client.requests).toHaveLength(1);
});
