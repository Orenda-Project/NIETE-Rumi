// The rendered document's TEXT NODES — what a teacher actually reads off the page.
//
// This exists because the gate of record for the expert's chief complaint (raw LaTeX printed
// as literal text) cannot be a scan of the lp_doc's strings. The strings are SUPPOSED to carry
// `$...$`; the defect is a `$` that survives INTO THE PAGE. Only the rendered output can tell
// those two apart, so MATH_LEAK reads the built HTML, and so does DISTRACTOR_VISIBLE — which
// is not about whether a distractor code exists (it must) but about where it is painted.
//
// A full HTML parser is overkill and a dependency we do not need: the renderer emits its own
// markup, well-formed, with no CDATA and no unquoted attributes. So this is a tag scanner that
// keeps a stack of the classes it is inside. It deliberately does NOT try to be a browser.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr", "path", "rect", "circle",
  "ellipse", "line", "polyline", "polygon", "use", "stop"]);

// Never-painted regions. <head> is not the page; a <style> body is CSS; an SVG's aria-label
// and <title> are read to a screen reader, not printed — and the KaTeX MathML twin is a
// parallel encoding of what the HTML span already draws (it would double-count every symbol).
const SKIP_TAGS = new Set(["head", "style", "script", "title", "annotation", "math"]);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  middot: "·", mdash: "—", ndash: "–", rarr: "→", ldquo: "“",
  rdquo: "”", times: "×", hellip: "…" };

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (ENT[n] !== undefined ? ENT[n] : m));
}

/**
 * Every painted text run in an HTML string.
 * @returns {Array<{text:string, classes:string[], tags:string[]}>}
 *   `classes` is the flattened class list of every ancestor, so a caller can ask
 *   "was this painted inside a teacher note?" without walking a tree.
 */
function textNodes(html) {
  const out = [];
  const stack = [];            // [{tag, cls:[]}]
  const src = String(html);
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
  let last = 0;
  let skipDepth = 0;
  let m;

  const flush = (upTo) => {
    if (skipDepth) return;
    const raw = src.slice(last, upTo);
    if (!raw) return;
    const t = decode(raw).replace(/\s+/g, " ");
    if (!t.trim()) return;
    const classes = [];
    const tags = [];
    for (const f of stack) { tags.push(f.tag); for (const c of f.cls) classes.push(c); }
    out.push({ text: t, classes, tags });
  };

  while ((m = tagRe.exec(src))) {
    flush(m.index);
    last = tagRe.lastIndex;
    if (m[2] === undefined) continue;                     // comment / doctype / CDATA
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] || "";
    const selfClose = m[4] === "/";
    if (close) {
      if (SKIP_TAGS.has(tag) && skipDepth) skipDepth--;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    if (SKIP_TAGS.has(tag)) { if (!selfClose) skipDepth++; continue; }
    if (selfClose || VOID.has(tag)) continue;
    const cm = /\bclass\s*=\s*"([^"]*)"/.exec(attrs) || /\bclass\s*=\s*'([^']*)'/.exec(attrs);
    stack.push({ tag, cls: cm ? cm[1].split(/\s+/).filter(Boolean) : [] });
  }
  flush(src.length);
  return out;
}

/** Just the words, joined — for a coarse "does this string appear on the page at all" check. */
const plainText = (html) => textNodes(html).map((n) => n.text).join(" ");

module.exports = { textNodes, plainText, decode };
