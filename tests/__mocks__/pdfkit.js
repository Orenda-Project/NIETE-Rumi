/**
 * pdfkit stub for the root test suite.
 *
 * pdfkit lives in bot/node_modules and the root test job runs before bot deps
 * install, so any suite whose chain reached certificate, reading-report or
 * video-assembly rendering died on an unresolved module. Several suites already
 * hand-roll a `jest.mock('pdfkit', …, { virtual: true })`; those keep working
 * untouched, because an explicit per-test mock takes precedence over
 * moduleNameMapper. This stub is the floor for the suites that never had one.
 *
 * The document RECORDS what was drawn rather than no-opping, so a test can assert
 * "the name reached the page" without the dependency present. Every drawing method
 * returns the document, matching pdfkit's chaining contract; `end()` emits `end`
 * on the next tick so a caller awaiting the stream resolves instead of hanging.
 */

const { EventEmitter } = require('events');

class PDFDocument extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.page = { width: 595, height: 842, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    this.x = 0;
    this.y = 0;
    /** Everything written, in order — the assertable surface. */
    this.textCalls = [];
    this.imageCalls = [];
    this.fontCalls = [];

    const chain = () => this;
    for (const m of ['fontSize', 'fillColor', 'strokeColor', 'lineWidth', 'opacity',
                     'rect', 'roundedRect', 'circle', 'ellipse', 'polygon', 'path',
                     'moveTo', 'lineTo', 'fill', 'stroke', 'fillAndStroke', 'clip',
                     'save', 'restore', 'translate', 'scale', 'rotate', 'addPage',
                     'moveDown', 'moveUp', 'lineGap', 'dash', 'undash']) {
      this[m] = chain;
    }
    this.font = (name) => { this.fontCalls.push(name); return this; };
    this.registerFont = (name, file) => { this.fontCalls.push({ name, file }); return this; };
    this.text = (t, ...rest) => { this.textCalls.push({ text: t, args: rest }); return this; };
    this.image = (src, ...rest) => { this.imageCalls.push({ src, args: rest }); return this; };
    this.linearGradient = () => ({ stop() { return this; } });
    this.widthOfString = () => 0;
    this.heightOfString = () => 0;
    this.pipe = (dest) => dest;
  }

  end() {
    // Emit asynchronously: callers wire their 'end'/'data' listeners after end().
    setImmediate(() => this.emit('end'));
    return this;
  }
}

module.exports = PDFDocument;
module.exports.default = PDFDocument;
