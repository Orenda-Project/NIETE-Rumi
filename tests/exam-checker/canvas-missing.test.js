'use strict';
/**
 * bd-vq0mfv (COS 20261027T162300): on 27 Oct 2026 a prod sqs-worker build dropped the optional `canvas` (bot install
 * "added 731 packages" against 783 on the same commit). The build still passed, and the worker then crashed at boot,
 * 45x "Cannot find module 'canvas'", through sqs-worker.js:42 → exam-grading.worker.js → exam-checker/index.js:13 →
 * annotation.service.js:21. No main/quiz consumer for ~15 min.
 * (b) A missing canvas degrades exam annotation only: the worker's module graph loads, and annotating a page fails
 *     with CANVAS_NOT_AVAILABLE, which annotateBatch already treats as one student's failure.
 * (a) is scripts/assert-native-modules.test.js: a missing canvas fails the build instead.
 */
const path = require('path');

const BOT = path.join(__dirname, '../../bot');

function missingCanvas() {
  const err = new Error("Cannot find module 'canvas'");
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

describe('canvas missing (the 27 Oct prod build)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('canvas', missingCanvas);
    jest.doMock(path.join(BOT, 'shared/storage/r2'), () => ({ uploadBuffer: jest.fn() }));
    jest.doMock('axios', () => ({ get: jest.fn(async () => ({ data: Buffer.from('not-an-image') })) }));
  });
  afterEach(() => jest.dontMock('canvas'));

  test('the exam-grading worker (the chain sqs-worker.js:42 loads at boot) still loads', () => {
    expect(() => require(path.join(BOT, 'workers/exam-grading.worker'))).not.toThrow();
  });

  test('exam-checker/index.js still loads and exports AnnotationService', () => {
    const ec = require(path.join(BOT, 'shared/services/exam-checker'));
    expect(typeof ec.AnnotationService.annotateBatch).toBe('function');
  });

  test('annotating a page fails with CANVAS_NOT_AVAILABLE, not a crash', async () => {
    const A = require(path.join(BOT, 'shared/services/exam-checker/annotation.service'));
    await expect(A.annotateImage('https://example.invalid/p1.jpg', { isFirstPage: true }, 'sid'))
      .rejects.toMatchObject({ code: 'CANVAS_NOT_AVAILABLE' });
  });

  test('annotateBatch resolves: the student is listed with no annotated pages (the existing per-page failure shape)', async () => {
    const A = require(path.join(BOT, 'shared/services/exam-checker/annotation.service'));
    const session = { id: 'sid', original_images: [{ url: 'https://example.invalid/p1.jpg', pageNumber: 1 }] };
    const result = {
      student: { name: 'S1', pageNumbers: [1] }, questionResults: [], percentage: 50, grade: 'C', totalMarks: 10,
      marksAwarded: 5,
    };
    const spy = jest.spyOn(A, 'annotateImage');
    await expect(A.annotateBatch(session, [result])).resolves.toEqual([{ student: 'S1', images: [] }]);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(spy.mock.results[0].value).rejects.toMatchObject({ code: 'CANVAS_NOT_AVAILABLE' });
  });
});

describe('canvas present: unchanged', () => {
  beforeEach(() => jest.resetModules());

  test('the module loads canvas on first use only, and registers the fonts once', () => {
    const real = jest.requireActual('canvas');
    const registerFont = jest.fn();
    const createCanvas = jest.fn(real.createCanvas);
    jest.doMock('canvas', () => ({ ...real, registerFont, createCanvas }));
    const A = require(path.join(BOT, 'shared/services/exam-checker/annotation.service'));
    expect(registerFont).not.toHaveBeenCalled();
    const c1 = A._canvas();
    const c2 = A._canvas();
    expect(c1).toBe(c2);
    expect(registerFont).toHaveBeenCalledTimes(3);
    expect(c1.createCanvas).toBe(createCanvas);
    jest.dontMock('canvas');
  });

  test('a real page still renders through the real canvas', async () => {
    const real = jest.requireActual('canvas');
    const png = real.createCanvas(400, 300).toBuffer('image/png');
    jest.doMock('axios', () => ({ get: jest.fn(async () => ({ data: png })) }));
    const uploads = [];
    jest.doMock(path.join(BOT, 'shared/storage/r2'), () => ({
      uploadBuffer: jest.fn(async (buf, key) => { uploads.push({ buf, key }); return `https://r2.invalid/${key}`; }),
    }));
    const A = require(path.join(BOT, 'shared/services/exam-checker/annotation.service'));
    const url = await A.annotateImage('https://example.invalid/p1.jpg', {
      studentName: 'S1', grade: 'B', percentage: 85, questionResults: [], isFirstPage: true, language: 'en',
      totalMarks: 10, marksAwarded: 8.5,
    }, 'sid');
    expect(typeof url).toBe('string');
    expect(uploads.length).toBe(1);
    expect(uploads[0].buf.slice(1, 4).toString()).toMatch(/PNG|JFI|�/);
  });
});
