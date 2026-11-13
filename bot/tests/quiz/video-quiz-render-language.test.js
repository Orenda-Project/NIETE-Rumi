'use strict';
/** bd-x0m19 / bd-kso9u / bd-47ukr — fixed English strings in the video-quiz render follow the quiz language. */
const render = require('../../shared/services/quiz/video-quiz-render.service');

const A = 'https://cdn.test/quiz-audio-opus';
const I = 'https://cdn.test/quiz-assets';
const row = (media, over = {}) => ({
  id: 'q1', question_text: 'What was outside the window?',
  option_a: 'Flower', option_b: 'Mano', option_c: 'Dog', option_d: null,
  correct_option: 'B', explanation: 'It was Mano.', option_feedback: null,
  render_pattern: 'P1', media, ...over,
});
const URDU = /[؀-ۿ]/;
const byRole = (msgs, role) => msgs.find((m) => m.role === role);

describe.each([['en'], ['ur']])('video quiz fixed strings, language %s', (language) => {
  const ur = language === 'ur';
  const p5 = () => render.build(row({
    language, question_audio: [`${A}/q.ogg`], grid: `${I}/grid.png`,
    option_images: [{ index: 0, url: `${I}/a.png` }],
  }, { render_pattern: 'P5' }));

  test('listen cue', () => {
    const body = byRole(p5(), 'stem_with_listen_cue').body;
    if (ur) { expect(body).toMatch(URDU); expect(body).not.toContain('Listen, then'); }
    else expect(body).toBe('🎧 What was outside the window?\nListen, then choose your answer.');
  });

  test('option grid caption', () => {
    const cap = byRole(p5(), 'option_grid').caption;
    if (ur) { expect(cap).toMatch(URDU); expect(cap).not.toContain('Your options'); }
    else expect(cap).toBe('Your options:');
  });

  test('picture flow prompt', () => {
    const body = p5().find((m) => m.kind === 'flow').body;
    if (ur) { expect(body).toMatch(URDU); expect(body).not.toContain('Now tap'); }
    else expect(body).toBe('Now tap the picture you think is right.');
  });

  test('wrong-answer fallback', () => {
    const msgs = render.build(row({ language }));
    const body = msgs.find((m) => m.role === 'feedback_incorrect').body;
    if (ur) { expect(body).toMatch(URDU); expect(body).not.toContain('Not quite'); expect(body).not.toContain('Keep going'); }
    else {
      expect(body).toContain('Not quite — the answer is');
      expect(body).toContain('Keep going, mistakes help you learn!');
    }
  });
});
