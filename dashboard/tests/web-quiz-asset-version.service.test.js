/**
 * The page asset version (`?v=` on every /wq/ script and style): a change to any file a page loads must change it,
 * so a phone never runs a new hub against an old cached Book script. The Book's files (wq-book.js / wq-book.css,
 * loaded by hub.js at hub.js's own ?v=) are hashed in.
 */
const fs = require('fs');
const path = require('path');

describe('assetVersion: every file the hub loads is hashed', () => {
  afterEach(() => jest.restoreAllMocks());
  test('the Book files are read into the version', () => {
    const { assetVersion } = require('../routes/web-quiz.routes');
    const read = jest.spyOn(fs, 'readFileSync');
    const v = assetVersion();
    expect(v).toMatch(/^[0-9a-f]{10}$/);
    const files = read.mock.calls.map(([p]) => path.basename(String(p)));
    expect(files).toEqual(expect.arrayContaining(['hub.js', 'hub-play.js', 'wq-book.js', 'wq-book.css']));
  });
  test('a change to the Book script alone changes the version', () => {
    const { assetVersion } = require('../routes/web-quiz.routes');
    const before = assetVersion();
    const real = fs.readFileSync;
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...a) => (path.basename(String(p)) === 'wq-book.js' ? Buffer.from('changed') : real(p, ...a)));
    expect(assetVersion()).not.toBe(before);
  });
});
