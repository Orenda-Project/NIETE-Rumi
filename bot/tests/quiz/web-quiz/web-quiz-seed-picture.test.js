'use strict';
/**
 * The "seed" picture a child sees on the web quiz.
 *
 * WhatsApp has no seed emoji, so a picture question written for WhatsApp stands a chestnut 🌰
 * in for "seed" (the plant-parts LEAF question: 🌸 🍃 🌰 🥕, with "That is a seed." as the
 * feedback for 🌰). The page turned 🌰 into the bank's chestnut drawing, which a child reads as
 * a chestnut or an onion. A seed is drawn as beans — the seed a Pakistani child knows (rajma,
 * lobia) — and the drawing has no leaves, so it never competes with the LEAF option.
 */
const Pictures = require('../../../shared/services/quiz/pictures');

const BEANS_RED = '#9D5044'; // the kidney-bean colour of Fluent "beans" (flat)
const SPROUT_GREEN = /#86D72F/i; // Fluent "seedling" leaves

describe('a seed is drawn as beans', () => {
  test.each(['🌰', '🫘'])('the emoji %s on a picture option stands for "seed"', (e) => {
    expect(Pictures.emojiNoun(e)).toBe('seed');
  });

  test('the seed drawing is beans: no chestnut, and no leaves to confuse with a LEAF option', () => {
    const inner = Pictures.colorInner('seed');
    expect(inner).toBeTruthy();
    expect(inner.toUpperCase()).toContain(BEANS_RED.toUpperCase());
    expect(inner).not.toMatch(SPROUT_GREEN);
    expect(inner).not.toBe(Pictures.colorInner('chestnut'));
  });

  test('a seedling (🌱) is still a seedling', () => {
    expect(Pictures.emojiNoun('🌱')).toBe('seedling');
    expect(Pictures.colorInner('seedling')).toMatch(SPROUT_GREEN);
  });
});
