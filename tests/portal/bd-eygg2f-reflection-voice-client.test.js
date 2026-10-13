/**
 * bd-eygg2f — ICT feedback (IAB Experience View, row 5): a teacher can answer the reflection question by
 * speaking. The dashboard's bot client carries her recording's R2 key to the bot, and waits long enough for
 * the bot to transcribe it AND write the acknowledgement (the typed answer only waits for the second).
 */
jest.mock('axios', () => ({ post: jest.fn() }));

describe('portal-coaching.client submitReflection (bd-eygg2f)', () => {
  let axios;
  beforeEach(() => {
    jest.resetModules();
    process.env.MAIN_BOT_URL = 'https://bot.example';
    process.env.INTERNAL_API_KEY = 'k';
    axios = require('axios');
    axios.post.mockReset().mockResolvedValue({ status: 200, data: { done: true } });
  });

  it('posts the audio key to the bot and gives transcription time (90s or more)', async () => {
    const Client = require('../../dashboard/services/portal-coaching.client');
    await Client.submitReflection({ userId: 'u1', coachingSessionId: 'cs-1', audioKey: 'reflection_audio/u1/2026-10/portal_a.webm' });
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://bot.example/api/internal/coaching/reflection');
    expect(body).toMatchObject({ userId: 'u1', coachingSessionId: 'cs-1', audioKey: 'reflection_audio/u1/2026-10/portal_a.webm' });
    expect(opts.timeout).toBeGreaterThanOrEqual(90_000);
  });
});
