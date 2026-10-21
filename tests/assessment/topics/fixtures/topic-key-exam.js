'use strict';
// A small paper shared by the topic-key test and the snapshot script. Questions carry an `slo` code.
module.exports = {
  unseen: {
    objective: {
      MCQs: [
        { question: 'Which word rhymes with cat?', options: ['hat', 'dog', 'sun'], answer: 'hat', marks: 1, slo: 'E-1' },
        { question: 'Which word rhymes with bee?', options: ['tree', 'cow'], answer: 'tree', marks: 1, slo: 'E-1' },
        { question: 'Pick the noun.', options: ['run', 'ball'], answer: 'ball', marks: 1, slo: 'E-1' },
      ],
    },
    subjective: {
      'Short answer': [
        { question: 'Write a sentence with "big".', answer: 'The dog is big.', marks: 2, slo: 'E-2' },
        { question: 'Describe your school.', answer: 'Any two facts.', marks: 2, slo: 'E-9' },
        { question: 'Untagged question.', answer: 'x', marks: 1 },
      ],
    },
  },
};
