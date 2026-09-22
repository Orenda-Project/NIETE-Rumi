/**
 * bd-5tgzv — the report she gets back must OPEN.
 *
 * The dedupe resend called `sendDocumentFromUrl(url, 'classroom-observation.pdf')`.
 * On NIETE the stored artefact is not a PDF: the FICO hero renderer returns a
 * PNG, `uploadReportImage` writes it to `reports/{user}/{session}_report.png`
 * with `ContentType: image/png`, and its URL goes into the column named —
 * misleadingly — `report_pdf_url`. Measured on production, completed DC sessions
 * since 1 Aug 2026: 12,749 store a `.png`, 5 store nothing, and **zero** store a
 * `.pdf`. So the resend was shipping PNG bytes labelled as a PDF, every time.
 *
 * That is FEAT-098 coming back. report-generator.service.js:877 carries the
 * warning verbatim: "WhatsApp delivered a PDF that WAS actually PNG bytes, so
 * every PDF reader rejected it as corrupt." The original delivery branches on
 * the rendered shape and calls sendImage; the resend must match it.
 *
 * The document branch stays, because the PDFKit/HTML renderers do return real
 * PDFs — it is simply never the NIETE path today.
 */

const {
  priorReportDelivery,
  resolveDuplicateSubmission,
} = require('../../bot/shared/services/coaching/audio-hash-cache');

describe('priorReportDelivery — decide by what the artefact actually IS', () => {
  test('the hero PNG is an image', () => {
    expect(priorReportDelivery('https://r2.example/reports/u1/s1_report.png'))
      .toBe('image');
  });

  test('a real PDF is a document', () => {
    expect(priorReportDelivery('https://r2.example/reports/u1/s1_report.pdf'))
      .toBe('document');
  });

  test('extension case and a query string do not fool it', () => {
    expect(priorReportDelivery('https://r2.example/s1_report.PNG?sig=abc&x=1')).toBe('image');
    expect(priorReportDelivery('https://r2.example/s1_report.PDF?sig=abc')).toBe('document');
  });

  test('no url is nothing to send', () => {
    for (const none of [null, undefined, '']) {
      expect(priorReportDelivery(none)).toBe('none');
    }
  });

  test('an unrecognised extension is treated as an image, not a PDF', () => {
    // The hero PNG is the only artefact NIETE produces. Guessing "document" on
    // an unknown URL is what broke this; guessing "image" degrades to a picture
    // that renders rather than a file that will not open.
    expect(priorReportDelivery('https://r2.example/s1_report')).toBe('image');
  });
});

describe('the resend delivers the same way the first report did', () => {
  function harness(reportUrl) {
    const calls = { images: [], documents: [], messages: [] };
    return {
      calls,
      opts: {
        updateIfNotTerminal: async () => ({ applied: true }),
        sendMessage: async (to, body) => { calls.messages.push([to, body]); },
        sendImageFromUrl: async (to, url, caption) => { calls.images.push([to, url, caption]); },
        sendDocumentFromUrl: async (to, url, name) => { calls.documents.push([to, url, name]); },
        getMessage: (k) => `catalog:${k}`,
        getLanguage: async () => 'ur',
        log: () => {},
        warn: () => {},
      },
      ctx: {
        coachingSessionId: 'current', from: '923497552393', userId: 'u1',
        audioHash: 'a'.repeat(64),
        duplicate: { id: 'prior', created_at: '2026-09-15T05:59Z', analysis_data: {}, report_pdf_url: reportUrl },
      },
    };
  }

  test('a PNG report goes back as an IMAGE — never as a .pdf document', async () => {
    const h = harness('https://r2.example/reports/u1/prior_report.png');
    await resolveDuplicateSubmission(h.ctx, h.opts);

    expect(h.calls.images).toHaveLength(1);
    expect(h.calls.images[0][1]).toBe('https://r2.example/reports/u1/prior_report.png');
    expect(h.calls.documents).toEqual([]);
  });

  test('a real PDF still goes back as a document', async () => {
    const h = harness('https://r2.example/reports/u1/prior_report.pdf');
    await resolveDuplicateSubmission(h.ctx, h.opts);

    expect(h.calls.documents).toHaveLength(1);
    expect(h.calls.images).toEqual([]);
  });

  test('no stored report — she still gets the message, and nothing broken is sent', async () => {
    const h = harness(null);
    await resolveDuplicateSubmission(h.ctx, h.opts);

    expect(h.calls.messages).toHaveLength(1);
    expect(h.calls.images).toEqual([]);
    expect(h.calls.documents).toEqual([]);
  });

  test('a failed image send does not fail the dedupe — the score is already reused', async () => {
    const h = harness('https://r2.example/reports/u1/prior_report.png');
    h.opts.sendImageFromUrl = async () => { throw new Error('media gone'); };
    await expect(resolveDuplicateSubmission(h.ctx, h.opts)).resolves.toBe(true);
    expect(h.calls.messages).toHaveLength(1);
  });
});
