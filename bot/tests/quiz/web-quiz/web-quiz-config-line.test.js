'use strict';
/**
 * web_quiz.config: the boot line's shape. Names and hosts only, never a value
 * that is a secret; the child-voice rule matches the challenge's own.
 */
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { logEvent } = require('../../../shared/utils/structured-logger');
const Line = require('../../../shared/services/quiz/web-quiz-config-line');

const SECRET = 'not-a-real-secret-value-0123456789';

test('logs bucket names, the link host and where the token secret comes from, and no secret value', () => {
  const env = {
    WEB_QUIZ_AUDIO_BUCKET: 'quiz-audio-x', R2_BUCKET_NAME: 'default-x', WEB_QUIZ_BASE_URL: 'https://kids.example.test/',
    PORTAL_URL: 'https://portal.example.test', WEB_QUIZ_TOKEN_SECRET: SECRET, INTERNAL_API_KEY: SECRET, R2_SECRET_ACCESS_KEY: SECRET,
  };
  Line.logWebQuizConfig(env);
  expect(logEvent).toHaveBeenCalledWith('web_quiz.config', {
    audioBucket: 'quiz-audio-x', childVoiceBucket: 'quiz-audio-x', baseHost: 'kids.example.test', tokenSecret: 'own',
  });
  expect(JSON.stringify(logEvent.mock.calls)).not.toContain(SECRET);
});

test('fallbacks: default bucket, PORTAL_URL host, derived secret; nothing set: nulls and "none"', () => {
  expect(Line.webQuizConfig({ R2_BUCKET_NAME: 'default-x', PORTAL_URL: 'https://portal.example.test', INTERNAL_API_KEY: SECRET, CHILD_VOICE_BUCKET: 'voice-x' }))
    .toEqual({ audioBucket: 'default-x', childVoiceBucket: 'voice-x', baseHost: 'portal.example.test', tokenSecret: 'derived' });
  expect(Line.webQuizConfig({ WEB_QUIZ_BASE_URL: 'not a url' }))
    .toEqual({ audioBucket: null, childVoiceBucket: null, baseHost: null, tokenSecret: 'none' });
});

test('the child-voice bucket is the one the challenge really uploads to', () => {
  const Challenge = require('../../../shared/services/quiz/web-quiz-challenge');
  for (const env of [{}, { R2_BUCKET_NAME: 'd' }, { WEB_QUIZ_AUDIO_BUCKET: 'a', R2_BUCKET_NAME: 'd' }, { CHILD_VOICE_BUCKET: ' v ', WEB_QUIZ_AUDIO_BUCKET: 'a' }]) {
    expect(Line.webQuizConfig(env).childVoiceBucket).toBe(Challenge.childVoiceBucket(env));
  }
});
