/**
 * bd-17mht — staging the book crops a lesson actually references.
 *
 * The renderer inlines a crop from `<outDir>/<ref>.jpg` (template.js:735). The
 * crops live in R2 under `lp612/page-truth/<book>/figures/`. This is the step
 * that puts them where the renderer looks.
 *
 * It runs AFTER the authoring LLM call — which takes 3-5 minutes — so the one
 * or two downloads it performs are off the critical path.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
}));
const { downloadFromR2 } = require('../../bot/shared/storage/r2');
const { refsFromDoc, stageFigures } = require('../../bot/shared/services/lp612-pagetruth.service');

const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');

function docWith(blocks) {
  return { sections: [{ id: 's1', blocks }] };
}

describe('refsFromDoc', () => {
  test('finds textbook_figure refs anywhere in the doc', () => {
    const doc = {
      sections: [
        { blocks: [{ type: 'textbook_figure', ref: 'grade_10_biology/pg_008_f0' }] },
        { blocks: [{ type: 'diagram', spec: { type: 'geometry' } }] },
      ],
      page2: { board_final: { blocks: [{ type: 'textbook_figure', ref: 'grade_9_biology/pg_123_f1' }] } },
    };
    expect(refsFromDoc(doc).sort()).toEqual([
      'grade_10_biology/pg_008_f0',
      'grade_9_biology/pg_123_f1',
    ]);
  });

  test('de-duplicates and ignores blocks without a ref', () => {
    const doc = docWith([
      { type: 'textbook_figure', ref: 'a/pg_001_f0' },
      { type: 'textbook_figure', ref: 'a/pg_001_f0' },
      { type: 'textbook_figure', src: 'local.jpg' },
      { type: 'diagram', spec: { type: 'flow' } },
    ]);
    expect(refsFromDoc(doc)).toEqual(['a/pg_001_f0']);
  });

  test('refuses a traversing ref rather than fetching it', () => {
    const doc = docWith([{ type: 'textbook_figure', ref: '../../pre_gen_lps/x' }]);
    expect(refsFromDoc(doc)).toEqual([]);
  });
});

describe('stageFigures', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-stage-'));
    downloadFromR2.mockReset();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('writes each crop to <outDir>/<ref>.jpg from the right R2 key', async () => {
    downloadFromR2.mockResolvedValue(JPEG);
    const res = await stageFigures({
      refs: ['grade_10_biology/pg_008_f0'],
      outDir: dir,
    });

    expect(downloadFromR2).toHaveBeenCalledWith(
      'lp612/page-truth/grade_10_biology/figures/pg_008_f0.jpg'
    );
    const p = path.join(dir, 'grade_10_biology', 'pg_008_f0.jpg');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p)).toEqual(JPEG);
    expect(res.staged).toEqual(['grade_10_biology/pg_008_f0']);
    expect(res.missing).toEqual([]);
  });

  test('a missing crop is reported, never thrown — the page degrades to words', async () => {
    downloadFromR2.mockRejectedValue(new Error('NoSuchKey'));
    const res = await stageFigures({ refs: ['a/pg_001_f0'], outDir: dir });
    expect(res.staged).toEqual([]);
    expect(res.missing).toEqual(['a/pg_001_f0']);
  });

  test('no refs means no R2 call at all', async () => {
    const res = await stageFigures({ refs: [], outDir: dir });
    expect(downloadFromR2).not.toHaveBeenCalled();
    expect(res.staged).toEqual([]);
  });
});
