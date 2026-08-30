/**
 * What a coach sees when the register cannot be read.
 *
 * Two rules, both learned the hard way. Returning { data: { error } } from a
 * data_exchange makes WhatsApp render its own "Something went wrong. Try again
 * later." — which is what a coach saw on the first live run, and it taught nobody
 * anything. And when we DO get to say something, it must be in the coach's terms:
 * an upstream billing error is our problem, not theirs, and pasting a vendor's HTTP
 * 402 into a WhatsApp screen in a school is not a message, it is a leak.
 */

const { describeFailure } = require('../../bot/shared/services/roster/roster-extraction.service');

describe('describeFailure', () => {
  it('never shows a coach an upstream billing error', () => {
    const msg = describeFailure('402 This request requires more credits, or fewer max_tokens. '
      + 'You requested up to 65536 tokens, but can only afford 1401. '
      + 'To increase, visit https://openrouter.ai/settings/credits');
    expect(msg).not.toMatch(/402|credits|max_tokens|openrouter/i);
    expect(msg).toMatch(/not available right now|try again/i);
  });

  it('never leaks a URL or a key fragment', () => {
    expect(describeFailure('401 No auth credentials found sk-or-v1-2ea...937'))
      .not.toMatch(/sk-or|https?:\/\//);
  });

  it('tells the coach to retake the photo when the page itself was the problem', () => {
    expect(describeFailure('could not parse JSON from an empty response')).toMatch(/photo/i);
  });

  it('treats a rate limit as temporary, not as the coach doing something wrong', () => {
    const msg = describeFailure('429 Too Many Requests');
    expect(msg).toMatch(/moment|again/i);
    expect(msg).not.toMatch(/429/);
  });

  it('is always short enough to read on a phone', () => {
    for (const e of ['402 credits', '429 rate', 'boom', 'ETIMEDOUT']) {
      expect(describeFailure(e).length).toBeLessThanOrEqual(160);
    }
  });
});
