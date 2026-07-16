/**
 * Regression guard: when the PDF render/send path in deliverOxbridgeLp throws,
 * the swallowed catch MUST emit at level='error' — not the default 'info'.
 *
 * Why: a real, customer-visible LP delivery failure that hides in info-level
 * noise cost 48+ hours of Oxbridge deliveries on the NIETE deployment. Axiom
 * error alerting is level-based; info-level renders it invisible.
 */

const path = require('path');

function load({ pdfError }) {
  jest.resetModules();

  const logToFile = jest.fn();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile }));

  jest.doMock('../../bot/shared/config/supabase', () => ({}));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    setJson: jest.fn().mockResolvedValue(),
    getJson: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue({}),
    sendDocument: jest.fn().mockResolvedValue({}),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));

  // Force htmlToPdf to throw so the catch runs.
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({
    htmlToPdf: jest.fn().mockRejectedValue(pdfError),
  }));

  const svc = require('../../bot/shared/services/oxbridge-lp.service');
  return { svc, logToFile };
}

describe('deliverOxbridgeLp: PDF render failure logging', () => {
  it("logs the swallowed render/send failure at level='error' (not info)", async () => {
    const { svc, logToFile } = load({ pdfError: new Error('browserType.launch: exitCode=127') });

    const row = { id: 13, content_html: '<h1>x</h1><img src="https://example.com/a.png">', chapter_title: 'Waves and Energy' };
    const ok = await svc.deliverOxbridgeLp('923000000000', row, 'en');

    expect(ok).toBe(false);

    // Find the specific log call for the render/send failure.
    const failCall = logToFile.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('PDF render/send failed')
    );
    expect(failCall).toBeDefined();

    // Signature: logToFile(message, data, level). Level MUST be 'error'.
    expect(failCall[2]).toBe('error');
  });
});
