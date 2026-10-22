/**
 * Child-test stimulus (L2, bd-s1oo0.2) — renderInlineCards and the multi-element capture it needs.
 *
 * playwright-core is mocked virtually (the network/process boundary; same pattern as
 * tests/reports/html-to-pdf.test.js). What runs for real: html-to-pdf's htmlToElementImages, the
 * render module's source lookup, HTML build and result mapping. The in-page chunking script is
 * exercised for real by real-render.test.js.
 */

const bank = require('./fixtures/item-bank.fixture.json');

let page, context, browser, cards;

function load() {
  jest.resetModules();
  cards = [
    { part: 'story', text: 'Imran woke up', box: { width: 540, height: 500 } },
    { part: 'story', text: 'early for school', box: { width: 540, height: 500 } },
    { part: 'nonwords', text: 'maz zaj', box: { width: 540, height: 480 } },
  ].map((c, i) => ({
    screenshot: jest.fn().mockResolvedValue(Buffer.from(`PNG${i}`)),
    evaluate: jest.fn().mockResolvedValue({ part: c.part, text: c.text }),
    boundingBox: jest.fn().mockResolvedValue(c.box),
  }));
  page = {
    setContent: jest.fn().mockResolvedValue(),
    evaluate: jest.fn().mockResolvedValue(),
    $$: jest.fn().mockResolvedValue(cards),
    $: jest.fn().mockResolvedValue(null),
    screenshot: jest.fn(),
  };
  context = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue() };
  browser = { isConnected: () => true, newContext: jest.fn().mockResolvedValue(context), on: jest.fn(), close: jest.fn() };
  jest.doMock('playwright-core', () => ({ chromium: { launch: jest.fn().mockResolvedValue(browser) } }), { virtual: true });
  return {
    util: require('../../../bot/shared/utils/html-to-pdf'),
    render: require('../../../bot/shared/services/child-test/render'),
  };
}

afterEach(() => jest.resetModules());

describe('htmlToElementImages', () => {
  it('loads fonts, runs the page\'s beforeCapture hook, then shoots every matching element in order', async () => {
    const { util } = load();
    const out = await util.htmlToElementImages('<html></html>', { width: 540, selector: '.card' });
    expect(context.close).toHaveBeenCalled();
    expect(browser.newContext.mock.calls[0][0]).toMatchObject({ viewport: { width: 540 }, deviceScaleFactor: 2 });
    // fonts first, then the hook
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(String(page.evaluate.mock.calls[1][0])).toMatch(/__beforeCapture/);
    expect(page.$$).toHaveBeenCalledWith('.card');
    expect(out.map((o) => o.png.toString())).toEqual(['PNG0', 'PNG1', 'PNG2']);
    expect(out[0]).toMatchObject({ part: 'story', text: 'Imran woke up', widthPx: 1080, heightPx: 1000 });
  });

  it('fails loudly when nothing matched, never returns an empty set as success', async () => {
    const { util } = load();
    page.$$.mockResolvedValueOnce([]);
    await expect(util.htmlToElementImages('<html></html>', { selector: '.card' })).rejects.toThrow(/no element/i);
    expect(context.close).toHaveBeenCalled();
  });
});

describe('renderInlineCards', () => {
  it('builds the card HTML from the item bank and returns ordered PNG cards with their part', async () => {
    const { render } = load();
    const out = await render.renderInlineCards({ grade: 3, form: 'A', block: 'english', itemBank: bank });
    const sent = page.setContent.mock.calls[0][0];
    for (const t of bank.grades['3'].forms.A.english.story.tokens.slice(0, 5)) expect(sent).toContain(t);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.part)).toEqual(['story', 'story', 'nonwords']);
    expect(out.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(Buffer.isBuffer(out[0].png)).toBe(true);
    expect(browser.newContext.mock.calls[0][0].viewport.width).toBe(540);
  });

  it('refuses a grade or form the bank does not have', async () => {
    const { render } = load();
    await expect(render.renderInlineCards({ grade: 4, form: 'A', block: 'english', itemBank: bank })).rejects.toThrow(/grade 4/i);
    await expect(render.renderInlineCards({ grade: 3, form: 'C', block: 'english', itemBank: bank })).rejects.toThrow(/form C/i);
  });

  it('reads the committed item bank through the L1 accessor when none is injected', async () => {
    const { render } = load();
    jest.doMock('../../../bot/shared/services/child-test/item-bank', () => ({
      getForm: (g, f) => bank.grades[String(g)].forms[f],
      version: 'child-test-items-v1-fixture',
    }), { virtual: true });
    const out = await render.renderInlineCards({ grade: 3, form: 'A', block: 'urdu' });
    expect(out).toHaveLength(3);
    expect(page.setContent.mock.calls[0][0]).toContain(bank.grades['3'].forms.A.urdu.story.tokens[0]);
  });
});

describe('printable card and coach sheet go through htmlToPdf', () => {
  it('renderPrintableCard returns the PDF buffer with A4 CSS page size', async () => {
    const { render } = load();
    page.pdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    const pdf = await render.renderPrintableCard({ grade: 3, form: 'A', itemBank: bank });
    expect(pdf.toString()).toMatch(/^%PDF/);
    expect(page.pdf.mock.calls[0][0]).toMatchObject({ preferCSSPageSize: true });
    expect(page.setContent.mock.calls[0][0]).toContain('data-page="maths-strip"');
  });

  it('renderCoachSheet renders the coach copy', async () => {
    const { render } = load();
    page.pdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    await render.renderCoachSheet({ grade: 5, form: 'B', itemBank: bank });
    expect(page.setContent.mock.calls[0][0]).toContain('data-audience="coach"');
  });
});
