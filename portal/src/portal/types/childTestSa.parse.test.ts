import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Type-only files are never bundled, so a syntax slip here shows up only in a full tsc run: parse it on its own.
describe('childTestSa.ts', () => {
  it('parses, with SaDashboardSession outside SaResults', () => {
    const file = resolve(process.cwd(), 'src/portal/types/childTestSa.ts');
    const out = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true });
    expect((out.diagnostics || []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });
});
