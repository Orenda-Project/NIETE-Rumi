/* The child page (public/wq/wq.js, WQI): "Watch the lesson again" from a library question.
 *
 * A library quiz starts with its lesson video (optional). Once the questions start there was no way back to it: a
 * stuck child had to leave the quiz. Now a question of a quiz with a video carries a small "Watch the lesson again"
 * button that opens the video over the question; closing it pauses the video and returns to the same question, with
 * nothing answered. */
const WQI = require('../public/wq/wq.js');

const T = { vAgain: 'Watch the lesson again', close: 'Close' };
const V = { url: 'https://videos.example/lesson.mp4', poster: 'https://videos.example/lesson_poster.jpg' };

function fakeDoc() {
  const made = [];
  const el = (tag) => {
    const e = { tag, children: [], attrs: {}, listeners: {}, className: '', innerHTML: '', parentNode: null, paused: true, played: 0,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
      play() { this.paused = false; this.played += 1; return Promise.resolve(); }, pause() { this.paused = true; },
      querySelector(sel) { return made.find((m) => m !== this && sel === m.sel) || null; } };
    made.push(e); return e;
  };
  return { made, body: el('body'), createElement(tag) { const e = el(tag); e.sel = tag; return e; } };
}

test('a question of a quiz with a video carries the button; one without a video does not', () => {
  expect(WQI.rewatchHtml(V, T)).toContain('Watch the lesson again');
  expect(WQI.rewatchHtml(V, T)).toContain('id="wq-again"');
  expect(WQI.rewatchHtml(null, T)).toBe('');
  expect(WQI.rewatchHtml({ url: '' }, T)).toBe('');
});

test('opening it plays the lesson over the question; closing pauses it, removes it and calls back once', () => {
  const doc = fakeDoc();
  let closed = 0;
  const ov = WQI.openRewatch(doc, V, T, () => { closed += 1; });
  expect(doc.body.children).toContain(ov);
  const video = doc.made.find((m) => m.tag === 'video');
  expect(video.attrs.src).toBe(V.url);
  expect(video.attrs.poster).toBe(V.poster);
  expect(video.played).toBe(1);
  const close = doc.made.find((m) => m.tag === 'button');
  close.listeners.click.forEach((fn) => fn({ stopPropagation() {} }));
  expect(video.paused).toBe(true);
  expect(doc.body.children).not.toContain(ov);
  expect(closed).toBe(1);
  close.listeners.click.forEach((fn) => fn({ stopPropagation() {} }));
  expect(closed).toBe(1);
});
