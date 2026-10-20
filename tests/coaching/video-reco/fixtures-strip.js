'use strict';
// bd-gzfdu9 §4.9: the hero (794) and slim (480) report fixtures whose HTML was hashed on origin/sandbox 24312266a8,
// before the clip strip existed. Shared by report-image-strip.test.js.
const heroVm = (language) => ({
  language, brand: 'niete', teacherName: 'Sana', topic: language === 'ur' ? 'ریاضی' : 'Maths', date: '2026-10-20',
  score: { overall: 63, marks: 66, max: 104 },
  groups: [{ name: 'Student Engagement', score: 14, max: 28, pct: 50 }],
  narrative: { affirmation: 'x', moments: [] }, trend: [],
  tryNext: language === 'ur' ? 'ہر سوال کے بعد خاموشی سے تین تک گنیں۔' : 'After each question, count silently to three.',
});
const slimCard = (language) => ({
  language,
  header: { name: 'Sana', meta: 'Grade 4 · Maths', date: '20 Oct 2026', pct: 62 },
  wells: [language === 'ur' ? 'آپ نے انتظار کیا' : 'You waited for answers'],
  thing: { text: language === 'ur' ? 'ہر سوال کے بعد خاموشی سے تین تک گنیں۔' : 'After each question, count silently to three.', step: { name: 'We Do', index: 3 }, why: null },
});
module.exports = { heroVm, slimCard };
