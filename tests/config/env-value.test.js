/**
 * `envStr()` — read an env var the way a deployment actually delivers it.
 *
 * Why this exists (2026-08-18): NIETE's `AWS_REGION_TEXTRACT` was set in Railway
 * to the 16-character value `"ap-southeast-1"` — the region name WITH literal
 * double-quote characters around it. `AWS_TEXTRACT_ACCESS_KEY_ID` (22 chars for a
 * 20-char key) and `AWS_TEXTRACT_SECRET_ACCESS_KEY` (42 for 40) were quoted the
 * same way, all three on both the `bot` and `sqs-worker` services — the signature
 * of one block paste, not a typo.
 *
 * A `.env` file would have been fine: dotenv strips wrapping quotes when it parses
 * a file. A platform env var is delivered raw, so the quotes survive into
 * `process.env` and straight into the SDK. `@smithy` then rejected the region
 * (`Region not accepted: region=""ap-southeast-1"" is not a valid hostname
 * component`), which killed Textract — and, because the OCR fallback throws,
 * killed the coaching session with it. 30 sessions hit this; 23 teachers never
 * received their report.
 *
 * The lesson is not "strip quotes at that one call site". It is that ANY
 * env-derived config can arrive quote-wrapped, and the failure is silent until it
 * reaches something strict enough to complain. `envStr()` normalises, and warns
 * once per variable so the operator learns which var is malformed instead of the
 * value being quietly repaired forever.
 */

const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../../bot/shared/utils/env.js');
const LOGGER_PATH = path.resolve(__dirname, '../../bot/shared/utils/logger.js');

describe('envStr', () => {
  let envStr;
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const logger = require(LOGGER_PATH);
    warnSpy = jest.spyOn(logger, 'logWarn').mockImplementation(() => {});
    // eslint-disable-next-line global-require, import/no-dynamic-require
    ({ envStr } = require(ENV_PATH));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.__TEST_VAR;
    delete process.env.__TEST_VAR_2;
  });

  it('returns a clean value untouched', () => {
    process.env.__TEST_VAR = 'ap-southeast-1';
    expect(envStr('__TEST_VAR')).toBe('ap-southeast-1');
  });

  it('strips wrapping double quotes — the actual NIETE outage', () => {
    process.env.__TEST_VAR = '"ap-southeast-1"';
    expect(envStr('__TEST_VAR')).toBe('ap-southeast-1');
  });

  it('strips wrapping single quotes', () => {
    process.env.__TEST_VAR = "'ap-southeast-1'";
    expect(envStr('__TEST_VAR')).toBe('ap-southeast-1');
  });

  it('trims surrounding whitespace', () => {
    process.env.__TEST_VAR = '  ap-southeast-1\n';
    expect(envStr('__TEST_VAR')).toBe('ap-southeast-1');
  });

  it('handles whitespace OUTSIDE the quotes', () => {
    process.env.__TEST_VAR = ' "ap-southeast-1" ';
    expect(envStr('__TEST_VAR')).toBe('ap-southeast-1');
  });

  it('returns undefined for an unset var', () => {
    expect(envStr('__DEFINITELY_NOT_SET_12345')).toBeUndefined();
  });

  it('returns undefined for an empty var, so || fallbacks still fire', () => {
    // .env.template ships `AWS_REGION_TEXTRACT=` empty. An empty string is
    // falsy, so `envStr(a) || envStr(b)` must fall through to b — matching the
    // `process.env.X || process.env.Y` chains this replaces.
    process.env.__TEST_VAR = '';
    expect(envStr('__TEST_VAR')).toBeUndefined();
  });

  it('returns undefined for a var that is only quotes or whitespace', () => {
    process.env.__TEST_VAR = '""';
    expect(envStr('__TEST_VAR')).toBeUndefined();
  });

  it('does NOT strip quotes that are part of the value', () => {
    // A JSON-valued env var (NIETE has REGION_FRAMEWORK_MAP) must survive: its
    // first and last chars are braces, and inner quotes are meaningful.
    process.env.__TEST_VAR = '{"urban-i":"fico"}';
    expect(envStr('__TEST_VAR')).toBe('{"urban-i":"fico"}');
  });

  it('does NOT strip a lone leading or trailing quote', () => {
    // Unbalanced means we cannot know intent — leave it and let the consumer
    // fail loudly rather than silently inventing a value.
    process.env.__TEST_VAR = '"ap-southeast-1';
    expect(envStr('__TEST_VAR')).toBe('"ap-southeast-1');
  });

  it('strips only ONE layer of quotes', () => {
    process.env.__TEST_VAR = '""ap-southeast-1""';
    expect(envStr('__TEST_VAR')).toBe('"ap-southeast-1"');
  });

  it('warns, naming the variable, when it had to repair a value', () => {
    process.env.__TEST_VAR = '"ap-southeast-1"';
    envStr('__TEST_VAR');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, data] = warnSpy.mock.calls[0];
    expect(`${message} ${JSON.stringify(data)}`).toContain('__TEST_VAR');
  });

  it('does NOT warn for a clean value', () => {
    process.env.__TEST_VAR = 'ap-southeast-1';
    envStr('__TEST_VAR');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns only ONCE per variable, however many times it is read', () => {
    // These helpers get called on every client construction; an unthrottled
    // warning would flood the logs and bury the signal it exists to raise.
    process.env.__TEST_VAR = '"ap-southeast-1"';
    envStr('__TEST_VAR');
    envStr('__TEST_VAR');
    envStr('__TEST_VAR');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns separately for each distinct malformed variable', () => {
    process.env.__TEST_VAR = '"a-b-1"';
    process.env.__TEST_VAR_2 = '"c-d-2"';
    envStr('__TEST_VAR');
    envStr('__TEST_VAR_2');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('never throws on a malformed value', () => {
    // Config normalisation must not become a new way to crash at boot.
    process.env.__TEST_VAR = '"';
    expect(() => envStr('__TEST_VAR')).not.toThrow();
  });
});

describe('aws-textract.service region resolution', () => {
  const SERVICE_PATH = path.resolve(
    __dirname, '../../bot/shared/services/aws-textract.service.js'
  );

  beforeEach(() => {
    jest.resetModules();
    delete process.env.AWS_REGION_TEXTRACT;
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    jest.resetModules();
    delete process.env.AWS_REGION_TEXTRACT;
    delete process.env.AWS_REGION;
  });

  it('resolves a quote-wrapped AWS_REGION_TEXTRACT to a valid region', () => {
    // The exact live misconfiguration. `region` is read at module load, so the
    // env must be set before require().
    process.env.AWS_REGION_TEXTRACT = '"ap-southeast-1"';
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { __textractRegion } = require(SERVICE_PATH);
    expect(__textractRegion).toBe('ap-southeast-1');
  });

  it('falls through to AWS_REGION when the Textract override is empty', () => {
    process.env.AWS_REGION_TEXTRACT = '';
    process.env.AWS_REGION = 'us-east-1';
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { __textractRegion } = require(SERVICE_PATH);
    expect(__textractRegion).toBe('us-east-1');
  });

  it('prefers the Textract override over the generic region', () => {
    process.env.AWS_REGION_TEXTRACT = 'ap-southeast-1';
    process.env.AWS_REGION = 'us-east-1';
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { __textractRegion } = require(SERVICE_PATH);
    expect(__textractRegion).toBe('ap-southeast-1');
  });

  it('defaults to us-east-1 when neither is set', () => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { __textractRegion } = require(SERVICE_PATH);
    expect(__textractRegion).toBe('us-east-1');
  });
});
