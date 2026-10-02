/**
 * Child-test coach sheet — print fixes found while building the Islamabad print pack (L10, bd-s1oo0.10).
 *
 * Rendering the four coach sheets to PNG and reading them showed:
 *   1. the right edge of every table and number grid cut off (htmlToPdf's default 50px margin was
 *      applied on top of the sheet's own @page margin, so the laid-out width no longer fit);
 *   2. Urdu answers inside an English question cell drawn over the line above (the cell's Latin
 *      line height is too tight for Nastaliq, and the Latin font stack has no Urdu face — on the
 *      Railway Chromium, which has no system fonts, that is tofu);
 *   3. a section heading left alone at the foot of a page, its table on the next;
 *   4. no cue lines — the coach's printed copy did not carry the exact words that start and stop
 *      each block, which the window finder keys on.
 *
 * playwright-core is mocked virtually (the process boundary); the HTML builders run for real.
 */

const bank = require('../L2/fixtures/item-bank.fixture.json');
const html = require('../../../bot/shared/services/child-test/render/html');

const formOf = (g, f) => bank.grades[String(g)].forms[f];

function withUrduAccept(form) {
  const f = JSON.parse(JSON.stringify(form));
  f.english.questions[0].accept = ['planting trees', 'درخت لگا رہے تھے'];
  return f;
}

const CUE = {
  urdu: { start: 'اب شروع کریں', stop: 'بس، شکریہ', questions: 'اب کہانی کے بارے میں کچھ سوالات سنیں', first_sounds: 'اب ہر لفظ کی پہلی آواز بتائیں', nonwords: 'اب یہ بے معنی لفظ پڑھیں' },
  english: { start: 'Please start reading', stop: 'Stop, thank you', questions: 'Now listen to some questions about the story', nonwords: 'Now read these made-up words' },
  maths: { start: 'اب سوال شروع کریں', stop: 'بس، شکریہ', numbers: 'اب یہ نمبر باری باری پڑھیں', word_problem: 'اب یہ کہانی والا سوال غور سے سنیں' },
};

describe('coach sheet HTML', () => {
  for (const lang of ['ur', 'en']) {
    describe(lang, () => {
      const out = html.buildCoachSheetHtml({ grade: 3, formCode: 'A', form: withUrduAccept(formOf(3, 'A')), lang, cue: CUE });

      it('prints every cue line the coach must say, verbatim', () => {
        for (const block of Object.keys(CUE)) {
          for (const line of Object.values(CUE[block])) expect(out).toContain(line);
        }
      });

      it('isolates an Urdu answer inside an English cell in the Urdu face', () => {
        expect(out).toMatch(/<bdi class="ur"[^>]*>درخت لگا رہے تھے<\/bdi>/);
        expect(out).toMatch(/<bdi class="en"[^>]*>planting trees<\/bdi>/);
      });

      it('keeps each heading with what follows it', () => {
        const h3 = (out.match(/<h3>/g) || []).length;
        const kept = (out.match(/<div class="(blk|story)"><h3>/g) || []).length;
        expect(h3).toBeGreaterThan(0);
        expect(kept).toBe(h3);
        expect(out).toMatch(/\.blk\{[^}]*break-inside:avoid/);
        expect(out).toMatch(/h3\{[^}]*break-after:avoid/);
        // a long story grid must be free to break, or it leaves page 1 empty
        expect(out).not.toMatch(/<div class="blk"><h3>[^<]*\(\d+ (words|الفاظ)\)/);
      });
    });
  }

  it('still renders without cue lines (an older bank)', () => {
    const out = html.buildCoachSheetHtml({ grade: 3, formCode: 'A', form: formOf(3, 'A'), lang: 'ur' });
    expect(out).toMatch(/data-audience="coach"/);
    expect(out).not.toMatch(/class="cue"/);
  });
});

describe('renderCoachSheet', () => {
  let page;
  function load() {
    jest.resetModules();
    page = { setContent: jest.fn().mockResolvedValue(), evaluate: jest.fn().mockResolvedValue(), pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) };
    const context = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue() };
    const browser = { isConnected: () => true, newContext: jest.fn().mockResolvedValue(context), on: jest.fn(), close: jest.fn() };
    jest.doMock('playwright-core', () => ({ chromium: { launch: jest.fn().mockResolvedValue(browser) } }), { virtual: true });
    return require('../../../bot/shared/services/child-test/render');
  }

  it('lets the sheet\'s own @page margin govern (no extra PDF margin that clips the right edge)', async () => {
    const render = load();
    await render.renderCoachSheet({ grade: 3, form: 'A', itemBank: bank });
    expect(page.pdf.mock.calls[0][0]).toMatchObject({ preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
  });

  it('passes the bank\'s cue lines into the sheet', async () => {
    const render = load();
    await render.renderCoachSheet({ grade: 3, form: 'A', itemBank: bank });
    const sent = page.setContent.mock.calls[0][0];
    expect(sent).toMatch(/class="cue"/);
    expect(sent).toContain(bank.cue.english.stop);
  });
});
