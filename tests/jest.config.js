/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/tests/**/*.test.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
  ],
  // Force module resolution to root node_modules so Jest mocks work
  // even when bot/node_modules exists (dual-install scenario)
  moduleNameMapper: {
    '^openai$': '<rootDir>/node_modules/openai',
    '^ioredis$': '<rootDir>/node_modules/ioredis',
    // axios + form-data live in bot/node_modules (not root), and the root test
    // job runs before bot deps install — so source that requires them can't
    // resolve. Map to lightweight stubs (same pattern as pino/canvas above) so
    // the real whatsapp.service can load in the root suite.
    '^axios$': '<rootDir>/tests/__mocks__/axios.js',
    '^form-data$': '<rootDir>/tests/__mocks__/form-data.js',
    // bot-only optional/native packages — use lightweight mocks for OSS test suite
    '^pino$': '<rootDir>/tests/__mocks__/pino.js',
    // exceljs is bot-only too. The stub RECORDS rows rather than no-opping, so the
    // teacher-register tests can assert what the generator wrote without the dep.
    '^exceljs$': '<rootDir>/tests/__mocks__/exceljs.js',
    '^canvas$': '<rootDir>/tests/__mocks__/canvas.js',
    // Same case again: @supabase/supabase-js and the two AWS S3 packages live in
    // bot/node_modules, so any root suite whose chain reached bot/shared/config/supabase.js
    // or bot/shared/storage/r2.js died on an unresolved require rather than on its own
    // assertions. Ported from main, where these have been in place since 2026-08.
    '^@supabase/supabase-js$': '<rootDir>/tests/__mocks__/supabase-js.js',
    // The v2 SDK, required at module scope by the SQS queue driver. Any root suite that loads
    // the real text-message handler reaches it (handler → lesson-plan-queue → ./queue → SQS),
    // which is why that handler's older suite asserts against source text instead of loading
    // the module. With this stub the handler can actually be executed in a test.
    '^aws-sdk$': '<rootDir>/tests/__mocks__/aws-sdk.js',
    '^@aws-sdk/client-s3$': '<rootDir>/tests/__mocks__/aws-sdk-client-s3.js',
    '^@aws-sdk/s3-request-presigner$': '<rootDir>/tests/__mocks__/aws-sdk-s3-request-presigner.js',
    // Media + PDF: fluent-ffmpeg shells out to a real transcoder and the two
    // installer packages exist only to expose a binary path, so these are stubbed
    // rather than added as root deps — a unit suite must never invoke ffmpeg.
    // pdf-parse is 30MB and the suite that needed it only exercises a pure function.
    '^fluent-ffmpeg$': '<rootDir>/tests/__mocks__/fluent-ffmpeg.js',
    '^@ffmpeg-installer/ffmpeg$': '<rootDir>/tests/__mocks__/ffmpeg-installer.js',
    '^@ffprobe-installer/ffprobe$': '<rootDir>/tests/__mocks__/ffmpeg-installer.js',
    '^pdf-parse$': '<rootDir>/tests/__mocks__/pdf-parse.js',
    // Document + browser rendering: pdfkit, mammoth and the Playwright browser are
    // all bot-only. Suites that already install their own virtual mock keep it —
    // an explicit jest.mock takes precedence over moduleNameMapper. These are the
    // floor for the suites that never had one.
    '^pdfkit$': '<rootDir>/tests/__mocks__/pdfkit.js',
    '^mammoth$': '<rootDir>/tests/__mocks__/mammoth.js',
    '^playwright-core$': '<rootDir>/tests/__mocks__/playwright-core.js',
    '^@aws-sdk/client-textract$': '<rootDir>/tests/__mocks__/aws-sdk-client-textract.js',
    // Same case, same fix: dotenv lives in bot/node_modules and pg in
    // dashboard/node_modules, so every root suite that loads bot config or
    // dashboard source died on an unresolved require rather than on anything
    // it was actually asserting. Stubbing them also stops a developer's local
    // .env from leaking into test expectations.
    '^dotenv$': '<rootDir>/tests/__mocks__/dotenv.js',
    '^pg$': '<rootDir>/tests/__mocks__/pg.js',
    // The vendored LP v9 pipeline (bot/vendor/lp-v9) pulls three more bot-only packages at
    // module scope: ajv (schema), katex + mhchem (server-side maths), openchemlib (molecule
    // diagrams). Same rule as everything above — CI runs this suite before `bot/ npm ci`.
    // The katex mapping has THREE entries because lib/fonts.js also resolves the package's
    // own path to inline dist/katex.min.css; the more specific patterns must precede '^katex$'.
    '^katex/dist/contrib/mhchem\\.js$': '<rootDir>/tests/__mocks__/katex-mhchem.js',
    '^katex/package\\.json$': '<rootDir>/tests/__mocks__/katex-stub/package.json',
    '^katex$': '<rootDir>/tests/__mocks__/katex.js',
    '^ajv$': '<rootDir>/tests/__mocks__/ajv.js',
    '^openchemlib$': '<rootDir>/tests/__mocks__/openchemlib.js',
  },
  setupFiles: ['<rootDir>/tests/setup.js'],
  testEnvironment: 'node',
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
    // Disable Web Storage APIs to avoid Node.js 25 SecurityError
    experimentalVmModules: false,
  },
  // Disable localStorage/sessionStorage to avoid Node.js 25 SecurityError
  globals: {
    localStorage: undefined,
    sessionStorage: undefined,
  },
  verbose: true,
  collectCoverageFrom: [
    'bot/shared/**/*.js',
    'dashboard/services/**/*.js',
    '!**/node_modules/**',
    '!**/vendor/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  testTimeout: 30000,
};
