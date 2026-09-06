'use strict';
/**
 * Round 5 — the letters a QUESTION CARD draws must be the same letters
 * the picker offers. transcript-quiz-card.js keeps its own LETTERS array for
 * the diamonds it paints; video-quiz-render.service.js's optionLetter() is
 * what the sender and the card's own footer both build from. This asserts
 * they agree rather than assuming it, because a silent drift between the two
 * would put the wrong handle on a card nobody would notice until a child
 * tapped the button matching the letter drawn, not the letter answered.
 */
const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');
const render = require('../../bot/shared/services/quiz/video-quiz-render.service');

describe('the card LETTERS agree with render.optionLetter', () => {
  test('LETTERS[i] === optionLetter(i) for every position a card can hold (0..3)', () => {
    for (let i = 0; i <= 3; i += 1) {
      expect(Card.LETTERS[i]).toBe(render.optionLetter(i));
    }
  });
});
