/**
 * Vocabulary Word Selection Helpers
 *
 * Text-only helpers for vocabulary questions in the reading assessment:
 * distractor selection and a text-fallback question shape. The AI image
 * generation path (Gemini-composed 3-picture grids) was removed as part of
 * the bd-2540 Gamma/AI-media strip — reading assessment now uses the text
 * fallback exclusively.
 */

class VocabularyImageService {
  /**
   * Select appropriate distractor words for a target word
   * Filters out the target word and selects 2 random alternatives
   * @param {string} targetWord - The word to find distractors for
   * @param {string[]} availableWords - Pool of words from passage
   * @returns {string[]} Two distractor words
   */
  static selectDistractors(targetWord, availableWords) {
    // Filter out target word and short words (< 3 chars)
    const candidates = availableWords.filter(w =>
      w.toLowerCase() !== targetWord.toLowerCase() && w.length >= 3
    );

    // If not enough candidates, use common distractor words
    if (candidates.length < 2) {
      const commonDistractors = ['ball', 'cup', 'book', 'table', 'chair', 'door', 'window', 'pen'];
      const filtered = commonDistractors.filter(w => w.toLowerCase() !== targetWord.toLowerCase());
      // Shuffle and take what we need
      const shuffled = filtered.sort(() => Math.random() - 0.5);
      while (candidates.length < 2) {
        candidates.push(shuffled[candidates.length]);
      }
    }

    // Shuffle and take 2
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2);
  }

  /**
   * Select a good target word from passage for picture matching
   * Prefers concrete nouns that can be easily illustrated
   * @param {string[]} words - All words from passage
   * @returns {string} Target word for picture matching
   */
  static selectTargetWord(words) {
    // Filter to words that are likely concrete nouns (4+ chars, not too long)
    const candidates = words.filter(w => w.length >= 3 && w.length <= 10);

    if (candidates.length === 0) {
      return words[0]; // Fallback to first word
    }

    // Return random candidate
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * Fallback to text-only question if Gemini fails
   * @param {string} targetWord - The correct word
   * @param {string[]} distractors - Distractor words
   * @returns {object} Text-based question configuration
   */
  static createTextFallbackQuestion(targetWord, distractors) {
    const correctPosition = Math.floor(Math.random() * 3) + 1;

    // Arrange options
    const options = [];
    let distractorIndex = 0;
    for (let i = 1; i <= 3; i++) {
      if (i === correctPosition) {
        options.push(targetWord);
      } else {
        options.push(distractors[distractorIndex++]);
      }
    }

    logToFile('⚠️ Using text fallback for vocabulary question', {
      targetWord,
      options,
      correctPosition
    });

    return {
      type: 'receptive_text_fallback',
      question: `Which of these is a "${targetWord}"?\n\n1. ${options[0]}\n2. ${options[1]}\n3. ${options[2]}`,
      expected_answer: correctPosition.toString(),
      options: options,
      buttons: [
        { id: 'vocab_answer_1', title: '1' },
        { id: 'vocab_answer_2', title: '2' },
        { id: 'vocab_answer_3', title: '3' }
      ],
      scoring: 1
    };
  }
}

module.exports = VocabularyImageService;
