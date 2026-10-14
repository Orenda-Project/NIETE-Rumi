'use strict';
/**
 * The coaching report page's shell: escaping, the HTML document and its styles — v10 coaching test,
 * bd-v0toag.55 (Amena's ICT-3 template: step colours, green/amber/red bars, dark mode). Pure.
 * Used by coaching-report-page.js.
 */

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `
  :root { --bg:#f6f7f9; --card:#ffffff; --fg:#272b36; --muted:#5b6475; --line:#e3e6ec; --accent:#47BA7D;
    --s1:#ef8a12; --s2:#9b55e6; --s3:#3d5bd6; --s4:#2f9a46; --s5:#d63a6a;
    --green:#2f8a55; --amber:#d99a1e; --red:#c2552f; --track:#eceef2; --try:#fff8e8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161c; --card:#1d2129; --fg:#eceef3; --muted:#a6adbb;
    --line:#2c313b; --track:#2c313b; --try:#2a2617; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:20px 16px 32px; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; }
  section { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; margin:0 0 14px; }
  section.try { background:var(--try); border-color:var(--amber); }
  h1 { font-size:22px; margin:0 0 2px; } h2 { font-size:17px; margin:0 0 8px; }
  p { margin:0 0 8px; } ul { margin:0; padding-inline-start:20px; } li { margin:0 0 4px; }
  .muted { color:var(--muted); font-size:14px; }
  .big { font-size:40px; font-weight:700; line-height:1.1; margin:8px 0 0; }
  .chip { display:inline-block; color:#fff; border-radius:999px; padding:2px 10px; font-size:13px; font-weight:600; margin:0 0 6px; }
  .s1 { background:var(--s1); } .s2 { background:var(--s2); } .s3 { background:var(--s3); } .s4 { background:var(--s4); } .s5 { background:var(--s5); }
  .why { color:var(--muted); font-size:15px; }
  .row { display:flex; justify-content:space-between; gap:8px; font-weight:600; }
  .track { background:var(--track); border-radius:6px; height:10px; margin:6px 0 8px; overflow:hidden; }
  .bar { height:10px; border-radius:6px; } .bar.green { background:var(--green); } .bar.amber { background:var(--amber); } .bar.red { background:var(--red); }
  .sec { padding:10px 0; border-top:1px solid var(--line); } .sec:first-of-type { border-top:0; }
  .legend { display:flex; justify-content:space-between; gap:8px; font-size:14px; }
  svg { width:100%; height:auto; display:block; margin:0 0 8px; }
  img, audio { width:100%; border-radius:12px; display:block; }
  a.btn, button.btn { display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:10px 16px; border-radius:10px; font-weight:600; border:0; font:inherit; cursor:pointer; margin:4px 4px 0 0; }
  .useful label { display:block; margin-bottom:8px; }
  .useful .pick { display:flex; gap:8px; align-items:center; min-height:44px; padding:6px 8px; box-sizing:border-box; margin-bottom:8px; }
  .useful textarea { width:100%; box-sizing:border-box; font:inherit; padding:8px; border-radius:8px; border:1px solid currentColor; background:transparent; color:inherit; margin-bottom:8px; }
  a.more { display:block; text-align:center; font-weight:600; color:var(--s3); text-decoration:none; padding:12px; }
  html[lang="ur"] body { font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif; line-height:2.1; }
`;

/** The whole document; l = 'en' | 'ur' (Urdu is right to left). */
function shell(l, title, body) {
  const lang = l === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

module.exports = { esc, shell };
