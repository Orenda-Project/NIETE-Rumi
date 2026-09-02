/**
 * Vendor integrity for bot/vendor/lp-v9.
 *
 * The v9 pipeline is VENDORED, not depended on: the authoring brief, the JSON schemas,
 * the canon lint and the renderer are copies of an upstream tree that lives outside this
 * repo. A re-vendor that drops a file, truncates the brief or breaks an export would
 * otherwise surface as a mystery at author time — a lint that never fires, a schema that
 * accepts anything, a prompt with no rules in it.
 *
 * So this suite asserts the SHAPE of the vendored tree, loudly, in the cheap unit suite.
 * It deliberately does not assert file contents beyond "present and plausibly non-empty":
 * pinning bytes would fail on every legitimate upstream refresh.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.resolve(__dirname, '../../bot/vendor/lp-v9');

describe('lp-v9 vendored pipeline', () => {
  it('the vendor root exists', () => {
    expect(fs.existsSync(VENDOR)).toBe(true);
  });

  describe('required files are present and non-empty', () => {
    const REQUIRED = [
      // the canon gate + the renderer
      'lint_lp.js',
      'render_lp.js',
      // the schemas the gate validates against — BOTH, because the v2 corpus still renders
      'schema/lp_doc.schema.json',
      'schema/lp_doc.v2.schema.json',
      // the render/lint support library
      'lib/validate.js',
      'lib/template.js',
      'lib/overlay.js',
      'lib/rich.js',
      'lib/questions.js',
      'lib/domtext.js',
      'lib/fonts.js',
      'lib/migrate.js',
      'lib/pdfmeta.js',
      // the diagram engine
      'diagrams/index.js',
      'diagrams/lib/svg.js',
      'diagrams/lib/degenerate.js',
      // the author system prompt
      'brief_author_v3.md',
      // the re-vendor procedure
      'SYNC.md',
    ];

    it.each(REQUIRED)('%s exists and is non-empty', (rel) => {
      const p = path.join(VENDOR, rel);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(0);
    });
  });

  it('the author brief is a whole brief, not a truncated copy', () => {
    // The upstream brief is ~66KB. A partial copy (a failed scp, a `head`) is the failure
    // mode this catches: a 2KB "brief" would author garbage and nothing else would notice.
    const brief = fs.readFileSync(path.join(VENDOR, 'brief_author_v3.md'), 'utf8');
    expect(brief.length).toBeGreaterThan(40000);
  });

  it('the v3 schema is the closed heading system at schema_version 3.0', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(VENDOR, 'schema/lp_doc.schema.json'), 'utf8')
    );
    expect(schema.properties).toBeDefined();
    expect(schema.properties.schema_version).toBeDefined();
    expect(schema.properties.sections).toBeDefined();
  });

  it('lint_lp.js exports lint()', () => {
    // A literal path, not path.join: the repo's unresolved-require audit reads source text.
    const lintMod = require('../../bot/vendor/lp-v9/lint_lp.js');
    expect(typeof lintMod.lint).toBe('function');
  });

  it('lib/validate.js exports validateDoc()', () => {
    const { validateDoc } = require('../../bot/vendor/lp-v9/lib/validate.js');
    expect(typeof validateDoc).toBe('function');
  });

  it('render_lp.js loads and exports the page caps and type floors', () => {
    const r = require('../../bot/vendor/lp-v9/render_lp.js');
    expect(r.MAX_PAGES).toEqual(expect.objectContaining({ teach: expect.any(Number), support: expect.any(Number) }));
    expect(typeof r.BODY_FLOOR_PX).toBe('number');
    expect(typeof r.CHIP_FLOOR_PX).toBe('number');
    // programmatic entry — the service calls this instead of the CLI main()
    expect(typeof r.renderDoc).toBe('function');
  });

  it('the four embeddable fonts are vendored beside the pipeline', () => {
    for (const f of ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'NotoNastaliqUrdu.ttf']) {
      const p = path.join(VENDOR, 'fonts', f);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(10000);
    }
  });

  it('font resolution finds every vendored face (no silent tofu fallback)', () => {
    const { fontCss } = require('../../bot/vendor/lp-v9/lib/fonts.js');
    const r = fontCss({ urdu: true });
    expect(r.missing).toEqual([]);
    expect(r.resolved).toHaveLength(4);
  });
});
