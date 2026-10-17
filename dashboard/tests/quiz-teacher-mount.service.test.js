/**
 * The teacher home's edge mount line in dashboard/index.js: live (not commented out), and before the static handlers
 * and the SPA catch-all, so /quiz/teacher/<token> and /api/th/* reach the edge first (and fall through when off).
 */
const fs = require('fs');
const path = require('path');

/** The file's code lines only: whole-line // comments removed first (one may hold a path like /api/th/*), then block comments. */
function codeOf(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('dashboard/index.js mounts the teacher home edge before the static files and the SPA catch-all', () => {
  const code = codeOf(path.join(__dirname, '..', 'index.js'));
  const at = code.indexOf("app.use(require('./routes/quiz-teacher.routes').createQuizTeacherRouter())");
  expect(at).toBeGreaterThan(-1);
  expect(at).toBeLessThan(code.indexOf("app.use(express.static(path.join(__dirname, 'public')))"));
  expect(at).toBeLessThan(code.indexOf("app.get('*'"));
  expect(typeof require('../routes/quiz-teacher.routes').createQuizTeacherRouter).toBe('function');
});
