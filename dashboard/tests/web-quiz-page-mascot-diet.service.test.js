/**
 * Web quiz page (public/wq/wq.js): the mascot loops only where it matters, and a
 * mascot picture that fails is never a broken-image box. Runs the WHOLE page in the
 * shared harness; the mascot block's own behaviour is in web-quiz-mascot.service.test.js.
 */
const { page } = require('./wq-page-harness');

const loops = (html) => (html.match(/data-jloop="1"/g) || []).length;

test('the landing asks for one loop (the hello); the next screen asks for none', () => {
  const p = page({ lang: 'en' });
  expect(p.html()).toContain('data-jpose="hello"');
  expect(loops(p.html())).toBe(1);
  p.wq.who();
  expect(loops(p.html())).toBe(0);
});

test('the page listens for a failing picture on its root (error does not bubble: capture phase)', () => {
  const p = page({ lang: 'en' });
  expect((p.root.listeners.error || []).length).toBe(1);
  const slot = { className: 'wq-jimg' };
  const still = { tagName: 'IMG', className: '', parentNode: slot, attrs: { src: '/wq/jugnu/hello.webp' }, style: {},
    getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; } };
  p.root.fire('error', { target: still });
  expect(still.src).toBe('/wq/jugnu_hello.webp');
  p.root.fire('error', { target: still });
  expect(slot.className).toContain('wq-jgone');
});
