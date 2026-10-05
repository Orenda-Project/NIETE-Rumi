'use strict';
/* The one "this stem points at a picture" list. Cases are real stem shapes from the sandbox bank. */
const { pointsAtPicture } = require('../../shared/services/quiz/quiz-picture-words');

describe('pointsAtPicture', () => {
  test.each([
    'Look at the pictures. Which one is a LEAF?',
    "Look at the chart. If you have 41, what number is 'One More'?",
    'Which drawing set matches all four seasons best?',
    'A 4 ft child stands far from a concave mirror. Which image matches the lesson?',
    'What time is being shown on this clock?',
    'Select the circle from the images below',
    'How many shaded parts are shown in the diagram?',
    'تصویریں دیکھیں۔ ان میں پتا کون سا ہے؟',
    'اس تصویر میں کتنے پھول ہیں؟',
    'خاکے میں دل کا کون سا حصہ ہے؟',
  ])('points: %s', (t) => expect(pointsAtPicture(t)).toBe(true));

  test.each([
    'Why is a convex mirror image called virtual?',
    'A table shows apples = 125 and bananas = 275. How many altogether?',
    'A place is shown below the Equator on a world map. In which half is it?',
    'Why does a mirror look very shiny?',
    'ایک شکل والے حروف کون سے بتائے گئے؟',
    '“اس تصویر کو دیوار پر لٹکائیں” میں “لٹکائیں” کی جگہ کون سا لفظ آیا؟',
    'What is $\\frac{1}{2}$ of 8?',
    '',
    null,
  ])('does not point: %s', (t) => expect(pointsAtPicture(t)).toBe(false));
});
