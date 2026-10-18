/*
 * The look probe: one function a walker evaluates on a child screen (page.evaluate(src)), returning what the look
 * gate checks. Used by run_look.py here and by any walker of the deployed pages (pass this file's text as is).
 *   gutter   every box a child sees whose getBoundingClientRect() has left < 16 or right > innerWidth - 16 (a fixed
 *            full-width bar is a frame: its children are measured, not it; a sideways shelf is measured as one box)
 *   targets  every tappable smaller than 48 x 48
 *   emoji    emoji characters in visible text (the icon set replaces them)
 *   buttons  each Home / back / share / main button: size, radius, shadow, border, fill, and how far its label's
 *            middle sits from the box's middle
 *   primary  the [data-primary]'s bottom against innerHeight
 *   rows     the height of every list row (door rows and their loading placeholders)
 *   radii    the distinct corner radii of the boxes a child sees (a circle counts once, as 'circle'); a glyph
 *            ([aria-hidden=true] or an answer's shape marker .wq-shp; the brand mark) is not a box and is not counted
 * It reads only; it changes nothing on the page.
 */
() => {
  const vw = window.innerWidth, vh = window.innerHeight, G = 16, EPS = 0.5;
  const cs = (e) => getComputedStyle(e);
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = cs(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  const name = (e) => { const c = (typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\s+/).join('.') : ''; return e.tagName.toLowerCase() + c + (e.getAttribute('data-tap') ? '[data-tap=' + e.getAttribute('data-tap') + ']' : ''); };
  const clear = (v) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
  const boxy = (e) => { const s = cs(e); return /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(e.tagName) || !clear(s.backgroundColor) || !clear(s.boxShadow) || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0 || s.backgroundImage !== 'none'; };
  // inside a box that scrolls sideways on its own (a shelf), the box is measured, not what scrolls in it
  const inScroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = cs(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const frame = (e) => { const s = cs(e); const r = e.getBoundingClientRect(); return (s.position === 'fixed' || s.position === 'sticky') && r.width >= vw - 1; };
  const gutter = [];
  document.querySelectorAll('body *').forEach((e) => {
    if (!vis(e) || !boxy(e) || frame(e) || inScroller(e)) return;
    if (/^(HTML|BODY|SCRIPT|STYLE|SVG|PATH|IMG)$/i.test(e.tagName) && !boxy(e)) return;
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
    if (e.matches('.wq-app,.wq-boot,.wq-boot *')) return;
    const r = e.getBoundingClientRect();
    if (r.bottom < 0 || r.top > document.documentElement.scrollHeight) return;
    if (r.left < G - EPS || r.right > vw - G + EPS) gutter.push({ el: name(e), left: Math.round(r.left * 10) / 10, right: Math.round((vw - r.right) * 10) / 10 });
  });
  const BTN = '.wq-btn,[data-home],.wq-homebtn,a.wq-home,button.wq-home,.wqs-sec,.wq-dback,.wq-prback,.wqfc-share,[data-tap=share],[data-tap=home]';
  const buttons = [];
  document.querySelectorAll(BTN).forEach((e) => {
    if (!vis(e)) return;
    const s = cs(e); const r = e.getBoundingClientRect();
    let off = null;
    const txt = (e.innerText || '').trim();
    if (txt) {
      // the words a child sees: text in a box wider and taller than 1 px (a screen-reader-only word is clipped to 1 px)
      const rs = [];
      const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const pr = n.parentElement && n.parentElement.getBoundingClientRect();
        if (!n.textContent.trim() || !pr || pr.width <= 1 || pr.height <= 1 || !vis(n.parentElement)) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        Array.from(rg.getClientRects()).filter((x) => x.width > 0 && x.height > 0).forEach((x) => rs.push(x));
      }
      if (rs.length) {
        const top = Math.min(...rs.map((x) => x.top)), bot = Math.max(...rs.map((x) => x.bottom));
        const pt = parseFloat(s.paddingTop) || 0, pb = parseFloat(s.paddingBottom) || 0, bt = parseFloat(s.borderTopWidth) || 0, bb = parseFloat(s.borderBottomWidth) || 0;
        const mid = r.top + bt + pt + (r.height - bt - bb - pt - pb) / 2;
        off = Math.round(((top + bot) / 2 - mid) * 10) / 10;
      }
    }
    const home = e.matches('[data-home],.wq-homebtn,a.wq-home,button.wq-home,[data-tap=home]') || /^(home|ہوم)$/i.test(txt.replace(/[^\p{L}]/gu, ''));
    const icon = off === null; // no visible words: an icon-only control
    buttons.push({ el: name(e), home, icon, text: txt.slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), radius: s.borderTopLeftRadius, r: s.borderTopLeftRadius, shadow: s.boxShadow, border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor, bg: s.backgroundColor, color: s.color, labelOff: off, left: Math.round(r.left), right: Math.round(vw - r.right) });
  });
  const targets = [];
  document.querySelectorAll('a[href],button,[role=button],[data-tap]').forEach((e) => {
    if (!vis(e) || e.closest('.wq-boot')) return;
    const r = e.getBoundingClientRect();
    if (r.width < 48 - EPS || r.height < 48 - EPS) targets.push({ el: name(e), w: Math.round(r.width), h: Math.round(r.height) });
  });
  const emoji = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || !vis(p) || p.closest('script,style,[aria-hidden=true]')) continue;
    const m = n.textContent.match(/\p{Extended_Pictographic}/gu);
    if (m) emoji.push({ el: name(p), chars: m.join('') });
  }
  const radii = new Set();
  document.querySelectorAll('body *').forEach((e) => {
    if (!vis(e) || !boxy(e) || e.closest('svg,[aria-hidden=true],.wq-shp') || e.matches('.wq-app,.wq-boot,.wq-boot *')) return;
    const s = cs(e); const r = e.getBoundingClientRect(); const v = parseFloat(s.borderTopLeftRadius) || 0;
    if (v <= 0) return;
    radii.add(/%$/.test(s.borderTopLeftRadius) || v >= Math.min(r.width, r.height) / 2 - EPS ? 'circle' : Math.round(v) + 'px');
  });
  // every list row a child taps (the door rows and their loading placeholders): one height per list
  const rows = Array.from(document.querySelectorAll('.wq-drow,.wq-skrow')).filter(vis).map((e) => ({ el: name(e), h: Math.round(e.getBoundingClientRect().height) }));
  const prim = document.querySelector('[data-primary]');
  const pr = prim && vis(prim) ? prim.getBoundingClientRect() : null;
  return { vw, vh, dir: document.documentElement.dir || 'ltr', scrollW: document.documentElement.scrollWidth, oneButton: document.documentElement.classList.contains('wq-1b'), gutter, targets, emoji, buttons, radii: Array.from(radii).sort(), rows, primary: pr ? { el: name(prim), bottom: Math.round(pr.bottom), ok: pr.bottom <= vh } : null, screen: (document.querySelector('[data-screen]') || {}).getAttribute ? document.querySelector('[data-screen]').getAttribute('data-screen') : null };
}
