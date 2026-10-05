/**
 * bd-5rz1v.19 — reads the new UI's SOURCE for the design checks (checks/copy.test.ts,
 * checks/style.test.tsx). Test-only: it uses the file system and the TypeScript parser, and no
 * app code imports it.
 *
 * What counts as the new UI: every .ts/.tsx under src/portal/newui/ — the kit, the menu and
 * every screen built there — except tests, this folder, and tokens.ts (where colours are
 * DEFINED). A new screen goes under newui/ and is checked from its first commit.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { copyProblem } from './rules';

// __dirname, not import.meta.url: under jsdom the module URL is http://, not file://.
export const NEW_UI_DIR = resolve(__dirname, '..');

export type SourceFile = { rel: string; text: string };

export function newUiSourceFiles(dir = NEW_UI_DIR): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'checks' && entry.name !== '__snapshots__') walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && entry.name !== 'tokens.ts') {
        out.push({ rel: relative(dir, full).split('\\').join('/'), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const parse = (rel: string, text: string) =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const HAS_LETTER = /\p{L}/u;

/** String literals an expression can evaluate to: `a ? 'x' : 'y'`, `name || 'Signed in'`, ('x'). */
function literalLeaves(expr: ts.Expression): Array<ts.StringLiteral | ts.NoSubstitutionTemplateLiteral> {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr];
  if (ts.isParenthesizedExpression(expr)) return literalLeaves(expr.expression);
  if (ts.isConditionalExpression(expr)) return [...literalLeaves(expr.whenTrue), ...literalLeaves(expr.whenFalse)];
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind;
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.AmpersandAmpersandToken) {
      return [...literalLeaves(expr.left), ...literalLeaves(expr.right)];
    }
  }
  return [];
}

/* ── copy ────────────────────────────────────────────────────────────────── */

/** Props and keys whose string value a teacher reads (or hears, from a screen reader). */
const LABEL_NAMES = new Set([
  'label', 'title', 'aria-label', 'alt', 'placeholder', 'crumb', 'desktopTitle', 'backLabel', 'closeLabel',
  'emptyValue', 'aria-valuetext', 'text',
]);

export type CopyProblem = { file: string; line: number; text: string; why: string };

/**
 * Words written straight into new-UI source:
 *   - JSX text and string-literal JSX children → must come from copy.ts instead;
 *   - a string literal given to a label prop or key → must still be a label (copyProblem).
 */
export function scanCopy(rel: string, text: string): CopyProblem[] {
  if (rel === 'copy.ts') return [];
  const sf = parse(rel, text);
  const out: CopyProblem[] = [];
  const add = (node: ts.Node, t: string, why: string) => out.push({ file: rel, line: lineOf(sf, node), text: t, why });

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const t = node.getText(sf).trim();
      if (t && HAS_LETTER.test(t)) add(node, t, 'words in JSX: put them in copy.ts and pass them in');
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const lit of literalLeaves(node.expression)) {
        if (HAS_LETTER.test(lit.text)) add(lit, lit.text, 'a string as a JSX child: put it in copy.ts and pass it in');
      }
    } else if (ts.isJsxAttribute(node) && LABEL_NAMES.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      const lits = ts.isStringLiteral(init) ? [init] : ts.isJsxExpression(init) && init.expression ? literalLeaves(init.expression) : [];
      for (const lit of lits) {
        const why = copyProblem(lit.text);
        if (why) add(lit, lit.text, `${node.name.getText(sf)}: ${why}`);
      }
    } else if (ts.isPropertyAssignment(node) && LABEL_NAMES.has(node.name.getText(sf).replace(/^['"]|['"]$/g, ''))) {
      for (const lit of literalLeaves(node.initializer)) {
        const why = copyProblem(lit.text);
        if (why) add(lit, lit.text, `${node.name.getText(sf)}: ${why}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/* ── style: colour rule, logical spacing, reduced motion ─────────────────── */

export type StyleRule = 'feature-colour' | 'raw-colour' | 'physical' | 'motion' | 'theme';
export type StyleProblem = { file: string; line: number; rule: StyleRule; text: string };

/** The one file allowed to draw a feature colour. */
export const FEATURE_COLOUR_FILE = 'FeatureIcon.tsx';

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

/** Physical (left/right) utilities: in Urdu they point the wrong way. Use start/end. */
const PHYSICAL = /^-?(?:m[lr]|p[lr]|left|right|rounded-(?:[lr]|tl|tr|bl|br)|border-[lr]|scroll-[mp][lr]|space-x)(?:-|$)|^(?:text|float|clear)-(?:left|right)$/;

/**
 * Classes the OLD theme redefines, so they do not mean in the new UI what they say:
 *   grid         index.css forces `.grid` to direction:ltr in Urdu — use [display:grid] (GRID)
 *   rounded-lg/md/sm  tailwind.config.ts maps them to var(--radius) (1rem) — say the px
 */
const THEME_TRAP = /^(?:grid|rounded-(?:lg|md|sm))$/;

/** Utilities that MOVE something: only under motion-safe:. Colour transitions are fine. */
const MOTION = /^(?:animate-(?!none$)|transition$|transition-(?:all|transform)$)/;

/** Split a class at its last variant colon outside [brackets]: "md:[&>*]:pe-2" → ["md:[&>*]", "pe-2"]. */
function splitVariant(token: string): [string, string] {
  let depth = 0;
  let at = -1;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    else if (ch === ':' && depth === 0) at = i;
  }
  return at < 0 ? ['', token] : [token.slice(0, at), token.slice(at + 1)];
}

/**
 * Colour, direction and motion in new-UI source. Only CODE is read — string literals and
 * template text — so a comment may still mention a hex or a margin.
 */
export function scanStyle(rel: string, text: string): StyleProblem[] {
  const sf = parse(rel, text);
  const out: StyleProblem[] = [];
  const featureAllowed = rel === FEATURE_COLOUR_FILE || rel.endsWith(`/${FEATURE_COLOUR_FILE}`);

  const check = (node: ts.Node, value: string) => {
    const line = lineOf(sf, node);
    for (const token of value.split(/\s+/).filter(Boolean)) {
      const [variants, utility] = splitVariant(token);
      if (!featureAllowed && /(?:^|-)nu-f-/.test(utility)) out.push({ file: rel, line, rule: 'feature-colour', text: token });
      if (RAW_COLOUR.test(token) && !/theme\(/.test(token)) out.push({ file: rel, line, rule: 'raw-colour', text: token });
      if (PHYSICAL.test(utility)) out.push({ file: rel, line, rule: 'physical', text: token });
      if (MOTION.test(utility) && !/(?:^|:)motion-safe(?::|$)/.test(variants)) out.push({ file: rel, line, rule: 'motion', text: token });
      if (THEME_TRAP.test(utility)) out.push({ file: rel, line, rule: 'theme', text: token });
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text);
    else if (ts.isJsxText(node)) { /* words, not classes: the copy check reads these */ }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
