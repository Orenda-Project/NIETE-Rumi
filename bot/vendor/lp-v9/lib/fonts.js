// Font resolution + embedding for LP-HTML v8.
//
// Self-contained output is the point: the rendered HTML must carry its own fonts as
// base64 @font-face so a PDF produced on a laptop, on Railway and on EC2 look identical.
// "Text overlap" and "gibberish Urdu" (LP_DESIGN_RULES R6) are font-load races, not
// missing glyphs — that is why render_lp.js also awaits document.fonts.ready.
//
// Nothing here hardcodes an absolute /Users path: candidates are resolved relative to
// the repo root (four levels up from this file), then the OS font dirs as a last resort.

const fs = require("fs");
const path = require("path");

// VENDOR DIVERGENCE (see ../SYNC.md, "font resolution"):
//
// Upstream this file lived at <workspace>/.claude/skills/.../scripts/lp_html/lib, and
// REPO_ROOT was six levels up — the AUTHORING WORKSPACE, whose Reports/ and fonts/ trees
// carried the four TTFs as a fallback. Neither that workspace nor those trees exist on
// Railway, so both the root and the fallbacks are re-anchored here:
//
//   • REPO_ROOT is this repo's root (bot/vendor/lp-v9/lib -> four levels up). It is only
//     ever used to make report paths relative and to resolve a doc-relative figure `src`,
//     so pointing it at the deployment repo is the correct meaning, not a hack.
//   • the four faces are VENDORED into ../fonts and that is the ONLY candidate. A missing
//     face is a vendoring bug we want to see (tests/lp612/vendor-integrity.test.js asserts
//     `missing` is empty), not something to paper over with a machine-local path.
//
// .../<repo>/bot/vendor/lp-v9/lib
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const LOCAL_FONTS = path.resolve(__dirname, "..", "fonts");

const CANDIDATES = {
  "Inter:400": [[LOCAL_FONTS, "Inter-Regular.ttf"]],
  "Inter:600": [[LOCAL_FONTS, "Inter-SemiBold.ttf"]],
  "Inter:700": [[LOCAL_FONTS, "Inter-Bold.ttf"]],
  "Noto Nastaliq Urdu:400": [[LOCAL_FONTS, "NotoNastaliqUrdu.ttf"]],
};

function findFile(cands) {
  for (const [base, rel] of cands) {
    const p = path.join(base, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function faceCss(family, weight, file) {
  const b64 = fs.readFileSync(file).toString("base64");
  const fmt = file.endsWith(".woff2") ? "woff2" : file.endsWith(".otf") ? "opentype" : "truetype";
  const mime = fmt === "woff2" ? "font/woff2" : "font/ttf";
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;` +
    `src:url(data:${mime};base64,${b64}) format('${fmt}');}`;
}

/**
 * @param {{urdu:boolean}} opts
 * @returns {{css:string, resolved:string[], missing:string[]}}
 */
function fontCss({ urdu = false } = {}) {
  const want = ["Inter:400", "Inter:600", "Inter:700"];
  if (urdu) want.push("Noto Nastaliq Urdu:400");

  const css = [];
  const resolved = [];
  const missing = [];
  for (const key of want) {
    const [family, weight] = key.split(":");
    const file = findFile(CANDIDATES[key]);
    if (file) {
      css.push(faceCss(family, weight, file));
      resolved.push(`${key} <- ${path.relative(REPO_ROOT, file)}`);
    } else {
      // Not fatal: the family name may still resolve against an installed system font
      // (macOS ships Noto Nastaliq Urdu). We say so rather than rendering tofu silently.
      missing.push(key);
    }
  }
  return { css: css.join("\n"), resolved, missing };
}

/**
 * KaTeX's own woff2 faces, inlined so the maths does not depend on a fonts/ directory.
 *
 * The rewrite is scoped to ONE `@font-face` block at a time, and inside a block to that
 * block's own `src:` run. That scoping is the whole point — see bd-1doo3.
 *
 * The previous implementation matched `/src:([^;]+);/g` across the whole stylesheet. KaTeX
 * ships MINIFIED css, where `src:` is the LAST declaration in every `@font-face` block and so
 * carries no trailing `;`:
 *
 *   @font-face{...;src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2"),...("truetype")}
 *
 * `[^;]+` happily crosses `}`, so each match ran on to the NEXT `;` anywhere in the file and
 * the replacement ate every closing brace in its path. All 20 `@font-face` blocks — and the
 * `.katex{font:normal 1.21em KaTeX_Main,...}` base rule that follows them — collapsed into a
 * single block, in which only the LAST `font-family`/`src` pair (KaTeX_Typewriter) survives
 * the cascade. 19 of 20 KaTeX faces were therefore never declared.
 *
 * That printed as garbage rather than as tofu because of what KaTeX puts in those faces:
 * `\neq` is not a codepoint, it is an `\rlap`-ed U+E020 (a Private Use Area negation slash
 * living only in KaTeX_Main-Regular) painted over a plain `=`. A PUA codepoint has no
 * meaningful fallback, so Chrome substituted the body font and its unrelated PUA glyph. The
 * G10 determinants LP told teachers `|A| <smear> 0`.
 *
 * Gates: `test/run_tests.js` (block integrity) and `test/math_glyphs.js` (Chrome's own answer
 * to which font it painted U+E020 with).
 */
function katexCss() {
  const dist = path.dirname(require.resolve("katex/package.json")) + "/dist";
  const css = fs.readFileSync(path.join(dist, "katex.min.css"), "utf8");
  // `[^{}]*` cannot leave the block: an @font-face body contains no nested braces.
  return css.replace(/@font-face\{([^{}]*)\}/g, (block, body) =>
    // `[^;}]+` cannot leave the declaration, with or without a trailing `;`.
    `@font-face{${body.replace(/src:[^;}]+/g, (src) => {
      const woff2 = /url\(fonts\/([A-Za-z0-9_-]+\.woff2)\)/.exec(src);
      if (!woff2) return src;                       // keep whatever KaTeX shipped
      const f = path.join(dist, "fonts", woff2[1]);
      if (!fs.existsSync(f)) return src;
      const b64 = fs.readFileSync(f).toString("base64");
      // woff/ttf fallbacks are dropped on purpose: the file must be self-contained.
      return `src:url(data:font/woff2;base64,${b64}) format('woff2')`;
    })}}`);
}

module.exports = { fontCss, katexCss, REPO_ROOT };
