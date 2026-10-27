/**
 * The internal hcp endpoint tester page was served at /observability/hcp-test-viewer with no auth at all, and nothing
 * in the product links to it. It is removed, view and route both. This is a deletion, so there is no new line to
 * execute: the test reads dashboard/index.js the way tests/portal/session-rolling.test.js does and checks the view is
 * gone, so the page cannot come back unnoticed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('the hcp tester page is gone', () => {
  it('dashboard/index.js registers no /observability/hcp-test-viewer route', () => {
    const src = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.js'), 'utf8');
    expect(src).not.toMatch(/['"`]\/observability\/hcp-test-viewer['"`]/);
    expect(src).not.toMatch(/render\(\s*['"`]hcp-test-viewer['"`]/);
  });

  it('the view file no longer exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'dashboard', 'views', 'hcp-test-viewer.ejs'))).toBe(false);
  });
});
