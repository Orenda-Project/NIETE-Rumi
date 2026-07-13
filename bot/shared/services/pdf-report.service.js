const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { logToFile } = require('../utils/logger');
const { TEMP_DIR } = require('../utils/constants');

/**
 * PDF Report Generator Service
 * Generates professional classroom observation reports using PDFKit
 * Zero system dependencies - works on any platform including Railway
 *
 * Updated with perfected design:
 * - Rumi logo aligned with heading
 * - All elements with rounded corners
 * - Improved typography and spacing
 * - Professional timestamp badges
 */
class PDFReportService {
  // Brand colors (OECD template colors)
  static COLORS = {
    primary: '#1e3a5f',      // Navy blue
    secondary: '#64748b',    // Slate gray
    background: '#f8fafc',   // Light gray
    border: '#e2e8f0',       // Border gray
    excellent: '#16a34a',    // Green
    proficient: '#2563eb',   // Blue
    developing: '#f59e0b',   // Orange
    emerging: '#ef4444'      // Red
  };

  /**
   * Generate a classroom observation PDF report
   * @param {Object} reportData - Report data from GPT-5 mini analysis
   * @param {string} reportData.teacherName - Teacher's name
   * @param {string} reportData.observationDate - Date of observation
   * @param {string} reportData.subject - Subject taught
   * @param {string} reportData.topic - Lesson topic (inferred from transcript/lesson plan)
   * @param {string} reportData.observerName - Observer's name
   * @param {number} reportData.totalScore - Total score achieved
   * @param {number} reportData.maxScore - Maximum possible score
   * @param {Object} reportData.priorFeedback - Prior feedback incorporation data
   * @param {Array} reportData.goals - Array of goal objects with criteria
   * @param {Object} reportData.debriefReflection - Debrief & Reflection section data
   * @param {string} reportData.feedback - Overall feedback text
   * @returns {Promise<Buffer>} PDF buffer
   */
  static async generateClassroomObservationReport(reportData) {
    // Report design is pluggable per framework via the renderer registry.
    // The default renderer is the PDFKit layout (OECD/HOTS/TEACH/FICO);
    // MEWAKA (Tanzania CPD) maps to a Playwright HTML→PDF renderer because
    // its report shape (hero focus area + 6-domain Swahili scorecard +
    // inline SVG sparkline) doesn't fit the PDFKit layout. Adding a new
    // framework's report design is "register one line" in the registry,
    // not editing a hardcoded branch here.
    const { getReportRenderer } = require('./coaching/report-renderers/renderer-registry');
    const renderer = getReportRenderer(reportData.framework);
    return renderer.render(reportData);
  }

  /**
   * Default (PDFKit) report renderer — the shared OECD/HOTS/TEACH/FICO
   * layout. Behaviour is byte-identical to the pre-registry path.
   * @private
   */
  static async _generatePDFKitReport(reportData) {
    const startTime = Date.now();

    try {
      logToFile('Starting PDF report generation with perfected design', {
        teacher: reportData.teacherName,
        totalScore: reportData.totalScore,
        maxScore: reportData.maxScore
      });

      // Create PDF document. `bufferPages: true` retains every page in memory
      // so we can iterate `bufferedPageRange()` after all content is placed
      // and draw a per-page footer with the correct "Page N of M" — we don't
      // know M until we're done writing content.
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 70, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
      });

      // Register Naskh Arabic for BOTH Urdu and Arabic evidence text. We can't
      // use Nastaliq (the aesthetic choice on the hero PNG) here because the
      // Nastaliq font's GPOS anchor tables trip a fontkit crash — "Cannot read
      // properties of null (reading 'xCoordinate')" — on the very first
      // Urdu-only line. Naskh renders every line in the corpus cleanly and is
      // legible for both Urdu and Arabic readers. The previous version
      // registered `NotoSansArabic.ttf` but never called `doc.font('UrduFont')`,
      // so all RTL evidence rendered as Latin-1 mojibake ("d†Ìcl jö''") inside
      // Helvetica — an outright bug this fixes.
      const naskhPath = path.join(__dirname, '../fonts/NotoNaskhArabic-Regular.ttf');
      if (fs.existsSync(naskhPath)) {
        doc.registerFont('UrduFont',   naskhPath);
        doc.registerFont('ArabicFont', naskhPath);
        doc._hasUrduFont   = true;
        doc._hasArabicFont = true;
      }

      // Stash the transformer-supplied config on the doc so downstream helper
      // methods can call _barColor without every signature threading it
      // through. Keeps this renderer framework-agnostic — the transformer
      // owns the framework-specific chrome (see report-transformers/*).
      doc._colorBins         = reportData.colorBins || null;
      doc._performanceLevels = reportData.performanceLevels || null;

      // Collect PDF chunks
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));

      // Calculate percentage and performance level
      const percentage = Math.round((reportData.totalScore / reportData.maxScore) * 100);
      const performance = this._getPerformanceLevel(percentage, reportData.performanceLevels);

      // Build PDF content
      let yPos = 50;
      yPos = this._drawHeader(doc, reportData, percentage, performance, yPos);
      yPos = this._drawTeacherInfo(doc, reportData, yPos);

      // Scale legend — rendered iff the transformer supplied one (e.g. FICO's
      // 1-4 rubric). Renderer stays framework-agnostic; it just draws
      // whatever legend config it's given.
      if (reportData.scaleLegend && Array.isArray(reportData.scaleLegend.stops)) {
        yPos = this._drawScaleLegend(doc, yPos, reportData.scaleLegend);
      }

      // Domain at-a-glance strip (5 mini-cards, one per domain).
      if (reportData.goals && reportData.goals.length > 1) {
        yPos = this._drawDomainAtAGlance(doc, reportData.goals, yPos);
      }

      // Partial report note (if applicable)
      if (reportData.isPartialReport && reportData.partialReportNote) {
        yPos = this._drawPartialReportNote(doc, reportData.partialReportNote, yPos);
      }

      // Prior feedback section
      if (reportData.priorFeedback) {
        yPos = this._drawPriorFeedback(doc, reportData.priorFeedback, yPos);
      }

      // Performance Overview section
      yPos = this._drawPerformanceOverview(doc, reportData.goals, yPos);

      if (reportData.fidelitySection) {
        yPos = this._drawFidelitySection(doc, reportData.fidelitySection, yPos);
      }

      // Debrief & Reflection section (moved before Overall Feedback)
      if (reportData.debriefReflection) {
        yPos = this._drawDebriefReflection(doc, reportData.debriefReflection, yPos);
      }

      // "One thing to try next class" — commitment action (hero-style block).
      if (reportData.commitmentAction) {
        yPos = this._drawCommitmentAction(doc, reportData.commitmentAction, yPos);
      }

      // Overall feedback (moved to end, after debrief)
      yPos = this._drawOverallFeedback(doc, reportData.feedback, yPos);

      // Per-page footer (Page N of M + provenance) drawn AFTER all content
      // so we know the total page count.
      this._drawPageFooters(doc, reportData);

      // Finalize PDF
      doc.end();

      // Wait for PDF to finish
      const pdfBuffer = await new Promise(resolve => {
        doc.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });

      const duration = Date.now() - startTime;
      logToFile('✅ PDF report generated successfully', {
        teacher: reportData.teacherName,
        percentage: `${percentage}%`,
        performance: performance.label,
        pdfSizeKB: Math.round(pdfBuffer.length / 1024),
        durationMs: duration
      });

      return pdfBuffer;
    } catch (error) {
      logToFile('❌ Error generating PDF report', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /** Default performance-level bins used when reportData.performanceLevels is absent. */
  static DEFAULT_PERFORMANCE_LEVELS = [
    { threshold: 85, label: 'Excellent',  color: 'excellent' },
    { threshold: 70, label: 'Proficient', color: 'proficient' },
    { threshold: 55, label: 'Developing', color: 'developing' },
    { threshold: 0,  label: 'Emerging',   color: 'emerging' },
  ];

  /** Default colour bins used when reportData.colorBins is absent. */
  static DEFAULT_COLOR_BINS = [
    { threshold: 85, color: 'excellent' },
    { threshold: 70, color: 'proficient' },
    { threshold: 55, color: 'developing' },
    { threshold: 0,  color: 'emerging' },
  ];

  /**
   * Pick a bin by threshold-ladder. Bins are ordered high→low; the first
   * threshold ≤ pct wins. Colour is looked up from the COLORS palette.
   * @private
   */
  static _pickBin(pct, bins) {
    for (const b of bins) {
      if (pct >= b.threshold) return { ...b, color: this.COLORS[b.color] || b.color };
    }
    const last = bins[bins.length - 1] || { color: 'emerging' };
    return { ...last, color: this.COLORS[last.color] || last.color };
  }

  /**
   * Performance level for the top-right header badge — driven by the
   * transformer's performanceLevels config (or a sensible default).
   * @private
   */
  static _getPerformanceLevel(percentage, performanceLevels) {
    const bins = performanceLevels || this.DEFAULT_PERFORMANCE_LEVELS;
    return this._pickBin(percentage, bins);
  }

  /**
   * Bar colour by score — driven by the transformer's colorBins config
   * (or a sensible default). No framework-specific branching in the renderer.
   * @private
   */
  static _barColor(pct, colorBins) {
    return this._pickBin(pct, colorBins || this.DEFAULT_COLOR_BINS).color;
  }

  /**
   * Render text with proper formatting for evidence lines, including quotes.
   *
   * Chooses the font per line by script: any Arabic-script code point in the
   * line switches to the registered Nastaliq (Urdu) or Naskh (Arabic) font,
   * enabling OpenType shaping via features so Nastaliq ligatures actually
   * form. Latin-only lines stay on Helvetica.
   *
   * @private
   */
  static _renderMixedText(doc, text, x, y, options = {}) {
    const { width, fontSize = 7, align = 'left', lineGap = 2 } = options;
    const lines = (text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    let currentY = y;

    const renderLine = (content, fontName, color = '#000', textOpts = {}) => {
      doc.fontSize(fontSize).font(fontName).fillColor(color);
      doc.text(content, x, currentY, { width, align, lineGap, ...textOpts });
      currentY = doc.y + 5;
    };

    for (const rawLine of lines) {
      let line = rawLine;
      const isQuote =
        /^quote:/i.test(line) ||
        /^part 2 -\s*quote:/i.test(line);

      line = line.replace(/^Part 1 - [^:]+:/i, '').trim();
      line = line.replace(/^Part 2 -\s*Quote:/i, '').trim();
      line = line.replace(/^Quote:/i, '').trim();

      if (!line) continue;

      const script = this._detectScript(line);
      if (script === 'urdu' && doc._hasUrduFont) {
        renderLine(line, 'UrduFont', '#000', { align: 'right' });
      } else if (script === 'arabic' && doc._hasArabicFont) {
        renderLine(line, 'ArabicFont', '#000', { align: 'right' });
      } else if (isQuote) {
        const quoteText = line.replace(/^["“”]|["“”]$/g, '').trim();
        renderLine(`"${quoteText}"`, 'Helvetica-Oblique', '#666');
      } else {
        renderLine(line, 'Helvetica', '#000');
      }
    }
  }

  /**
   * Detect the script of a line for font selection.
   *   'urdu'    → any Arabic-script char AND report language is ur (or no hint)
   *   'arabic'  → any Arabic-script char AND report language is ar
   *   'latin'   → no Arabic-script chars
   *
   * We can't see reportData from here, so we default to 'urdu' when Arabic-script
   * chars appear — this project is Urdu-heavy and Nastaliq is a superset that
   * renders Arabic legibly too. The caller can force by pre-registering only
   * one of the two fonts.
   *
   * @private
   */
  static _detectScript(text) {
    // Arabic Unicode blocks: base, supplement, extended-A, presentation forms A/B.
    if (/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(text)) {
      return 'urdu';
    }
    return 'latin';
  }

  /**
   * Calculate height needed for text with wrapping (including quotes)
   * @private
   */
  static _calculateTextHeight(doc, text, fontSize, width, lineGap = 2) {
    if (!text) {
      return 0;
    }

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    let totalHeight = 0;

    for (const rawLine of lines) {
      let line = rawLine;
      const isQuote =
        /^quote:/i.test(line) ||
        /^part 2 -\s*quote:/i.test(line);

      line = line.replace(/^Part 1 - [^:]+:/i, '').trim();
      line = line.replace(/^Part 2 -\s*Quote:/i, '').trim();
      line = line.replace(/^Quote:/i, '').trim();

      if (!line) continue;

      const script = this._detectScript(line);
      let formatted, fontName;
      if (script === 'urdu' && doc._hasUrduFont) {
        formatted = line; fontName = 'UrduFont';
      } else if (script === 'arabic' && doc._hasArabicFont) {
        formatted = line; fontName = 'ArabicFont';
      } else if (isQuote) {
        formatted = `"${line.replace(/^["“”]|["“”]$/g, '').trim()}"`;
        fontName = 'Helvetica-Oblique';
      } else {
        formatted = line;
        fontName = 'Helvetica';
      }
      doc.fontSize(fontSize).font(fontName);
      const lineHeight = doc.heightOfString(formatted, { width, lineGap });
      totalHeight += lineHeight + 5;
    }

    return totalHeight;
  }

  /**
   * Truncate text to keep sections concise
   * @private
   */
  static _truncateText(text, maxChars = 750) {
    if (!text) return '';
    const clean = text.trim();
    if (clean.length <= maxChars) {
      return clean;
    }
    return `${clean.slice(0, maxChars).trim()}…`;
  }

  /**
   * Draw rounded progress bar
   * @private
   */
  static _drawRoundedProgressBar(doc, x, y, width, height, percentage, color, radius = 6) {
    // Background
    doc.roundedRect(x, y, width, height, radius)
       .fillAndStroke(this.COLORS.border, this.COLORS.border);

    // Filled portion
    if (percentage > 0) {
      const fillWidth = (width * percentage) / 100;
      doc.roundedRect(x, y, fillWidth, height, radius)
         .fill(color);
    }
  }

  /**
   * Header labels. If the transformer supplied `reportData.headerLabels`
   * (framework-specific institutional framing), use it verbatim; otherwise
   * fall back to the generic strings that this renderer has always shipped.
   *
   * This keeps the PDFKit renderer free of `framework === 'x'` branches —
   * the framework-specific chrome lives with the transformer that knows the
   * framework, and this renderer just consumes whatever config it's given.
   * @private
   */
  static _headerLabels(reportData) {
    const custom = reportData && reportData.headerLabels;
    if (custom && custom.title) return custom;
    return {
      eyebrow: 'A CELEBRATION OF YOUR TEACHING',
      title:   'Classroom Observation',
      sub:     'Teacher Performance Evaluation powered by Rumi',
    };
  }

  /**
   * Draw report header with logo
   * @private
   */
  static _drawHeader(doc, reportData, percentage, performance, yPos) {
    const L = this._headerLabels(reportData);

    // Rumi mark — small square PNG placed next to the header title.
    try {
      const logoPath = path.join(__dirname, '../assets/rumi-mark-navy.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, yPos + 8, { width: 34 });
      }
    } catch (error) {
      logToFile('⚠️  Logo not found, skipping', { error: error.message });
    }

    // Eyebrow — small uppercase kicker above the title.
    doc.fontSize(8)
       .fillColor(this.COLORS.secondary)
       .font('Helvetica-Bold')
       .text(L.eyebrow, 95, yPos + 5, { characterSpacing: 1.5 });

    // Title (framework-aware).
    doc.fontSize(21)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text(L.title, 95, yPos + 18);

    // Subtitle (framework-aware).
    doc.fontSize(10)
       .fillColor(this.COLORS.secondary)
       .font('Helvetica')
       .text(L.sub, 95, yPos + 46);

    // Score badge (top right).
    doc.fontSize(32)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text(`${percentage}%`, 450, yPos + 5);

    doc.fontSize(10)
       .fillColor(performance.color)
       .font('Helvetica')
       .text(performance.label, 450, yPos + 45);

    // Horizontal line.
    yPos += 74;
    doc.moveTo(50, yPos)
       .lineTo(545, yPos)
       .strokeColor(this.COLORS.primary)
       .lineWidth(2)
       .stroke();

    return yPos + 20;
  }

  /**
   * Draw a single line of text, auto-selecting the Urdu/Arabic font when the
   * text contains Arabic-script code points. Prevents mojibake for the topic /
   * teacher-name / other user-supplied fields that could be non-Latin.
   * @private
   */
  static _drawSmartText(doc, text, x, y, opts = {}) {
    const { fontSize = 10, color = '#000', font: latinFont = 'Helvetica', width, align } = opts;
    const script = this._detectScript(text || '');
    const font = (script === 'urdu' && doc._hasUrduFont) ? 'UrduFont'
               : (script === 'arabic' && doc._hasArabicFont) ? 'ArabicFont'
               : latinFont;
    const textOpts = {};
    if (width) textOpts.width = width;
    if (align) textOpts.align = align;
    doc.fontSize(fontSize).fillColor(color).font(font);
    doc.text(String(text || ''), x, y, textOpts);
  }

  /**
   * Draw teacher info section. Uses _drawSmartText for user-supplied strings
   * (teacher name, topic) so that a non-Latin value renders in Naskh instead
   * of Latin-1 mojibake — the same bug _renderMixedText addresses for the
   * indicator evidence text.
   * @private
   */
  static _drawTeacherInfo(doc, data, yPos) {
    const boxHeight = 130;

    doc.roundedRect(50, yPos, 495, boxHeight, 8)
       .fillAndStroke(this.COLORS.background, this.COLORS.border);

    const label = (t, x, y) => doc.fontSize(8).fillColor(this.COLORS.secondary).font('Helvetica').text(t, x, y);
    const value = (t, x, y, w) => this._drawSmartText(doc, t, x, y, { fontSize: 10, color: '#000', width: w });

    label('TEACHER', 60, yPos + 10);
    value(data.teacherName, 60, yPos + 25, 230);

    label('DATE', 300, yPos + 10);
    value(data.observationDate || new Date().toLocaleDateString(), 300, yPos + 25, 230);

    label('SUBJECT', 60, yPos + 50);
    value(data.subject || 'N/A', 60, yPos + 65, 230);

    label('TOPIC', 300, yPos + 50);
    value(data.topic || 'N/A', 300, yPos + 65, 230);

    label('LESSON PLAN', 60, yPos + 90);
    value(data.hasLessonPlan ? 'Submitted' : 'Not Submitted', 60, yPos + 105, 230);

    return yPos + boxHeight + 20;
  }

  /**
   * Scale legend — a slim reference strip so the reader knows what a
   * per-indicator score like "3/4" means without leaving the artefact.
   * Fully driven by config from the transformer (title + stops). No
   * framework-specific branching here.
   * @private
   */
  static _drawScaleLegend(doc, yPos, config) {
    const stops = (config.stops || []).map((s) => ({
      ...s,
      color: this.COLORS[s.color] || s.color,
    }));
    doc.fontSize(7).fillColor(this.COLORS.secondary).font('Helvetica-Bold')
       .text(config.title || 'SCALE', 50, yPos, { characterSpacing: 1.2 });
    const y = yPos + 12;
    const cellW = 495 / stops.length;
    stops.forEach((s, i) => {
      const x = 50 + i * cellW;
      // small colour swatch
      doc.roundedRect(x, y + 2, 10, 10, 2).fill(s.color);
      // number
      doc.fontSize(9).fillColor(this.COLORS.primary).font('Helvetica-Bold')
         .text(s.n, x + 16, y);
      // label
      doc.fontSize(9).fillColor(this.COLORS.secondary).font('Helvetica')
         .text(s.label, x + 24, y);
    });
    return yPos + 32;
  }

  /**
   * At-a-glance strip — one mini card per domain (up to 5). Lets the reader
   * triage the report in ~3 seconds. Framework-agnostic; safe for OECD/HOTS/
   * TEACH because it only inspects `goals` (each has title + score + maxScore).
   * @private
   */
  static _drawDomainAtAGlance(doc, goals, yPos) {
    doc.fontSize(7).fillColor(this.COLORS.secondary).font('Helvetica-Bold')
       .text('AT A GLANCE', 50, yPos, { characterSpacing: 1.2 });
    yPos += 14;

    const cardH = 46;
    const gap = 6;
    const rowW = 495;
    const cardW = (rowW - gap * (goals.length - 1)) / goals.length;

    goals.forEach((g, i) => {
      const x = 50 + i * (cardW + gap);
      const pct = g.maxScore ? Math.round((g.score / g.maxScore) * 100) : 0;
      const color = this._barColor(pct, doc._colorBins);

      // Card outline
      doc.roundedRect(x, yPos, cardW, cardH, 6)
         .fillAndStroke(this.COLORS.background, this.COLORS.border);

      // Domain title — strip "Domain N: " prefix so the small card doesn't
      // read as "Domain 1: L..." truncated. Keep the domain number as a chip.
      const m = /^Domain\s+(\d+):\s*(.+)$/i.exec(g.title || '');
      const num = m ? m[1] : String(i + 1);
      const shortTitle = m ? m[2] : (g.title || '');

      // Numbered chip
      doc.fontSize(7).fillColor('#fff').font('Helvetica-Bold');
      doc.roundedRect(x + 6, yPos + 6, 14, 12, 3).fill(this.COLORS.primary);
      doc.fillColor('#fff').text(num, x + 6, yPos + 8, { width: 14, align: 'center' });

      // Title
      doc.fontSize(8).fillColor(this.COLORS.primary).font('Helvetica-Bold')
         .text(shortTitle, x + 24, yPos + 7, { width: cardW - 30, lineBreak: false, ellipsis: true });

      // Score / bar
      doc.fontSize(9).fillColor('#000').font('Helvetica-Bold')
         .text(`${g.score}/${g.maxScore}`, x + 6, yPos + 22);
      this._drawRoundedProgressBar(doc, x + 6, yPos + cardH - 12, cardW - 12, 6, pct, color, 3);
    });

    return yPos + cardH + 16;
  }

  /**
   * "One thing to try next class" — the commitment action rendered as a
   * hero-style navy block, mirroring the celebration hero PNG. Rendered when
   * reportData.commitmentAction is a non-empty string. Threaded in via
   * report-generator.service.js.
   * @private
   */
  static _drawCommitmentAction(doc, action, yPos) {
    if (!action) return yPos;
    const width = 495;
    const paddingX = 20, paddingY = 16;
    const textWidth = width - paddingX * 2;

    // Use smart text so an Urdu action still renders. Measure with the right
    // font so the block wraps correctly.
    const script = this._detectScript(action);
    const useUrdu = script === 'urdu' && doc._hasUrduFont;
    const font = useUrdu ? 'UrduFont' : 'Helvetica-Bold';
    doc.fontSize(11).font(font);
    const textHeight = doc.heightOfString(action, { width: textWidth, lineGap: 3 });
    const boxHeight = textHeight + paddingY * 2 + 18;

    if (yPos + boxHeight > 750) { doc.addPage(); yPos = 50; }

    // Navy block, matches hero PNG's "try-next" block.
    doc.roundedRect(50, yPos, width, boxHeight, 10).fill(this.COLORS.primary);

    // Small eyebrow label
    doc.fontSize(7).fillColor('#9db0ff').font('Helvetica-Bold')
       .text('ONE THING TO TRY NEXT CLASS', 50 + paddingX, yPos + paddingY, { characterSpacing: 1.4 });

    // Body text
    doc.fontSize(11).fillColor('#ffffff').font(font);
    doc.text(action, 50 + paddingX, yPos + paddingY + 14, {
      width: textWidth,
      lineGap: 3,
      align: useUrdu ? 'right' : 'left',
    });

    return yPos + boxHeight + 20;
  }

  /**
   * Draw partial report note banner
   * @param {PDFDocument} doc - PDF document
   * @param {string} noteText - Partial report note text
   * @param {number} yPos - Current Y position
   * @returns {number} New Y position
   * @private
   */
  static _drawPartialReportNote(doc, noteText, yPos) {
    // Add spacing before the note
    yPos += 15;

    // Calculate text height for dynamic box sizing
    const textHeight = this._calculateTextHeight(doc, noteText, 9, 470, 2);
    const boxHeight = textHeight + 20; // Padding top and bottom

    // Draw orange/amber warning box
    doc.roundedRect(50, yPos, 495, boxHeight, 8)
       .fillAndStroke('#FFF8E1', '#FF9800'); // Amber background with orange border

    // Draw warning icon (exclamation mark)
    doc.fontSize(14)
       .fillColor('#FF6600')
       .font('Helvetica-Bold')
       .text('⚠', 60, yPos + 8);

    // Draw note text
    doc.fontSize(9)
       .fillColor('#6D4C00')
       .font('Helvetica')
       .text(noteText, 80, yPos + 10, {
         width: 450,
         lineGap: 2
       });

    return yPos + boxHeight + 15;
  }

  /**
   * Draw prior feedback section
   * @private
   */
  static _drawPriorFeedback(doc, priorFeedback, yPos) {
    // Add spacing before the section
    yPos += 20;

    // Check if this is first observation (competency_score = 1 and specific evidence pattern)
    const isFirstObservation = priorFeedback.evidence &&
                               priorFeedback.evidence.includes("first observed lesson") &&
                               priorFeedback.competency_score === 1;

    // For first observations, show empty state with explanation
    if (isFirstObservation) {
      const emptyMessage = "This criterion is not applicable because this is the teacher's first observed lesson with Rumi. Future reports will assess how the teacher incorporates feedback from this observation.";
      const evidenceHeight = this._calculateTextHeight(doc, emptyMessage, 7, 470, 2);

      // Include space for the section heading inside the box
      const boxHeight = 35 + 45 + 18 + evidenceHeight + 12;

      doc.roundedRect(50, yPos, 495, boxHeight, 8)
         .fillAndStroke(this.COLORS.background, this.COLORS.border);

      // Draw the section heading INSIDE the box
      doc.fontSize(14)
         .fillColor(this.COLORS.primary)
         .font('Helvetica-Bold')
         .text('Incorporation of Prior Feedback', 60, yPos + 12);

      doc.fontSize(10)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica')
         .text('SCORE', 60, yPos + 45);

      doc.fontSize(12)
         .fillColor('#000')
         .font('Helvetica-Bold')
         .text('N/A', 60, yPos + 60);

      doc.fontSize(7)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica')
         .text('EVIDENCE', 60, yPos + 80);

      doc.fontSize(7)
         .fillColor('#666')
         .font('Helvetica-Oblique')
         .text(emptyMessage, 60, yPos + 98, { width: 470, align: 'left', lineGap: 2 });

      return yPos + boxHeight + 30;
    }

    // Calculate evidence text height for normal case
    const evidence = priorFeedback.evidence || 'N/A';
    const evidenceHeight = this._calculateTextHeight(doc, evidence, 7, 470, 2);

    // Build box height step by step
    let boxHeight = 35; // Space for section heading
    boxHeight += 45; // Space for SCORE label + value + progress bar
    boxHeight += 18; // Space for EVIDENCE label
    boxHeight += evidenceHeight; // Actual evidence text height
    boxHeight += 12; // Bottom padding

    // Prior feedback box with dynamic height
    doc.roundedRect(50, yPos, 495, boxHeight, 8)
       .fillAndStroke(this.COLORS.background, this.COLORS.border);

    // Draw the section heading INSIDE the box
    doc.fontSize(14)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text('Incorporation of Prior Feedback', 60, yPos + 12);

    doc.fontSize(10)
       .fillColor(this.COLORS.secondary)
       .font('Helvetica')
       .text('SCORE', 60, yPos + 45);

    const score = priorFeedback.computed_marks || priorFeedback.score || 0;
    const maxScore = priorFeedback.max_marks || priorFeedback.maxScore || 5;

    doc.fontSize(12)
       .fillColor('#000')
       .font('Helvetica-Bold')
       .text(`${score}/${maxScore}`, 60, yPos + 60);

    // Rounded progress bar for prior feedback
    const priorPct = maxScore > 0
      ? Math.round((score / maxScore) * 100)
      : 0;
    const priorBarColor = this._barColor(priorPct, doc._colorBins);
    this._drawRoundedProgressBar(doc, 130, yPos + 60, 200, 10, priorPct, priorBarColor);

    // Evidence label
    doc.fontSize(7)
       .fillColor(this.COLORS.secondary)
       .font('Helvetica')
       .text('EVIDENCE', 60, yPos + 80);

    // Evidence text with mixed English/Urdu rendering
    this._renderMixedText(doc, evidence, 60, yPos + 98, {
      width: 470,
      fontSize: 7,
      lineGap: 2
    });

    return yPos + boxHeight + 20;
  }

  /**
   * Draw performance overview section
   * @private
   */
  static _drawPerformanceOverview(doc, goals, yPos) {
    doc.fontSize(18)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text('Performance Overview', 50, yPos);

    yPos += 30;

    // Render each goal
    for (const goal of goals || []) {
      // Check if we need a new page
      if (yPos > 700) {
        doc.addPage();
        yPos = 50;
      }

      const goalPct = Math.round((goal.score / goal.maxScore) * 100);
      const barColor = this._barColor(goalPct, doc._colorBins);

      // Goal header
      doc.fontSize(12)
         .fillColor('#000')
         .font('Helvetica-Bold')
         .text(goal.title, 50, yPos);

      doc.fontSize(10)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica')
         .text(`${goal.score}/${goal.maxScore}`, 450, yPos);

      yPos += 20;

      // Rounded progress bar
      this._drawRoundedProgressBar(doc, 50, yPos, 495, 10, goalPct, barColor);

      yPos += 20;

      // Criteria
      for (const criterion of goal.criteria || []) {
        const evidenceText = criterion.evidence || '';
        const photoText    = criterion.photoEvidence || '';
        const timestamp    = criterion.timestamp || '';

        let criterionBoxHeight = 28; // Base height for header (name + score)

        let evidenceHeight = 0;
        if (evidenceText) {
          criterionBoxHeight += 18; // EVIDENCE label
          evidenceHeight = this._calculateTextHeight(doc, evidenceText, 7, 470, 2);
          criterionBoxHeight += evidenceHeight;
        }
        let photoHeight = 0;
        if (photoText) {
          criterionBoxHeight += 10; // gap before photo callout
          photoHeight = this._calculateTextHeight(doc, photoText, 7, 458, 2);
          criterionBoxHeight += photoHeight + 20; // label + text + inner pad
        }
        criterionBoxHeight += 12; // Bottom padding

        // Check if the box fits on current page; if not, move to new page
        if (yPos + criterionBoxHeight > 750) {
          doc.addPage();
          yPos = 50;
        }

        // Criterion box with dynamic height
        doc.roundedRect(50, yPos, 495, criterionBoxHeight, 8)
           .fillAndStroke(this.COLORS.background, this.COLORS.border);

        // Indicator name (may be "1.1 Lesson Goal Clarity" per FICO transformer)
        doc.fontSize(9).fillColor('#000').font('Helvetica-Bold')
           .text(criterion.name, 60, yPos + 10);

        // Score at right
        doc.fontSize(9).fillColor(this.COLORS.secondary).font('Helvetica')
           .text(`${criterion.score}/${criterion.max}`, 480, yPos + 10);

        // Timestamp chip (subtle) if present — sits to the left of the score.
        // No unicode clock emoji here: Helvetica maps it to .notdef ("#ñ"),
        // which the old code silently shipped. Plain "@" is compact and legible.
        if (timestamp) {
          doc.fontSize(7).fillColor(this.COLORS.secondary).font('Helvetica')
             .text(`@ ${timestamp}`, 420, yPos + 12, { width: 55, align: 'right', lineBreak: false });
        }

        let cursorY = yPos + 28;

        if (evidenceText) {
          doc.fontSize(7).fillColor(this.COLORS.secondary).font('Helvetica')
             .text('EVIDENCE', 60, cursorY);
          this._renderMixedText(doc, evidenceText, 60, cursorY + 18, {
            width: 470, fontSize: 7, lineGap: 2,
          });
          cursorY += 18 + evidenceHeight;
        }

        if (photoText) {
          cursorY += 4;
          // Callout row — muted amber background so the reader knows it's
          // a different evidence type (classroom photo vs transcript audio).
          const calloutH = photoHeight + 18;
          doc.roundedRect(60, cursorY, 475, calloutH, 6)
             .fillAndStroke('#FFF8E1', '#F0D699');
          // Plain-ASCII label — camera emoji is missing from Helvetica and
          // renders as ".notdef" boxes (the same Latin-1 trap that killed
          // the Urdu evidence text before this pass).
          doc.fontSize(7).fillColor('#9A6B00').font('Helvetica-Bold')
             .text('PHOTO EVIDENCE', 70, cursorY + 6, { characterSpacing: 1.2 });
          // Body: route through _renderMixedText so Urdu / Arabic photo
          // notes get Naskh instead of Helvetica-mojibake.
          this._renderMixedText(doc, photoText, 70, cursorY + 18, {
            width: 455, fontSize: 7, lineGap: 2,
          });
        }

        yPos += criterionBoxHeight + 10;
      }

      yPos += 10;
    }

    return yPos;
  }

  /**
   * Draw fidelity to lesson plan section
   * @private
   */
  static _drawFidelitySection(doc, fidelity, yPos) {
    const columnWidths = [120, 160, 190];
    const summaryText = this._truncateText(
      fidelity.commentary || fidelity.note || 'Teacher followed the submitted plan with minor adaptations.',
      600
    );
    const strengthsList = (fidelity.strengths || []).slice(0, 3);
    const gapsList = (fidelity.gaps || []).slice(0, 3);
    const strengthsText = strengthsList.length ? `• ${strengthsList.join('\n• ')}` : '';
    const gapsText = gapsList.length ? `• ${gapsList.join('\n• ')}` : '';
    const evidenceItems = fidelity.evidence || [];

    const summaryHeight = summaryText ? this._calculateTextHeight(doc, summaryText, 8, 470, 2) : 0;
    const strengthsHeight = strengthsText ? this._calculateTextHeight(doc, strengthsText, 8, 470, 2) : 0;
    const gapsHeight = gapsText ? this._calculateTextHeight(doc, gapsText, 8, 470, 2) : 0;
    const evidenceHeight = evidenceItems.length
      ? this._estimateFidelityEvidenceHeight(doc, evidenceItems, columnWidths)
      : 0;

    const scoreBoxHeight = 50;
    let detailBoxHeight = 15;
    if (summaryHeight) {
      detailBoxHeight += 12 + summaryHeight + 10;
    }
    if (strengthsHeight) {
      detailBoxHeight += 12 + strengthsHeight + 10;
    }
    if (gapsHeight) {
      detailBoxHeight += 12 + gapsHeight + 10;
    }
    if (evidenceHeight) {
      detailBoxHeight += 12 + evidenceHeight + 10;
    }
    detailBoxHeight += 5;

    const sectionTotalHeight = 30 + scoreBoxHeight + 15 + detailBoxHeight;
    if (yPos + sectionTotalHeight > 750) {
      doc.addPage();
      yPos = 50;
    }

    doc.fontSize(18)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text('Fidelity to Lesson Plan', 50, yPos);

    yPos += 30;

    doc.roundedRect(50, yPos, 495, scoreBoxHeight, 8)
       .fillAndStroke(this.COLORS.background, this.COLORS.border);

    doc.fontSize(10)
       .fillColor(this.COLORS.secondary)
       .font('Helvetica')
       .text('Informational Score (not counted towards total)', 60, yPos + 10);

    const pct = fidelity.maxScore ? Math.round((fidelity.score / fidelity.maxScore) * 100) : 0;
    doc.fontSize(12)
       .fillColor('#000')
       .font('Helvetica-Bold')
       .text(`${fidelity.score || 0}/${fidelity.maxScore || 100}`, 60, yPos + 28);

    const barColor = this._barColor(pct, doc._colorBins);
    this._drawRoundedProgressBar(doc, 200, yPos + 30, 300, 10, pct, barColor);

    yPos += scoreBoxHeight + 15;

    doc.roundedRect(50, yPos, 495, detailBoxHeight, 8)
       .fillAndStroke(this.COLORS.background, this.COLORS.border);

    let cursor = yPos + 15;

    if (summaryHeight) {
      doc.fontSize(8)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica-Bold')
         .text('SUMMARY', 60, cursor);
      cursor += 12;
      doc.fontSize(8)
         .fillColor('#000')
         .font('Helvetica')
         .text(summaryText, 60, cursor, { width: 470, align: 'left', lineGap: 2 });
      cursor = doc.y + 10;
    }

    if (strengthsHeight) {
      doc.fontSize(8)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica-Bold')
         .text('STRENGTHS', 60, cursor);
      cursor += 12;
      doc.fontSize(8)
         .fillColor('#000')
         .font('Helvetica')
         .text(strengthsText, 60, cursor, { width: 470, align: 'left', lineGap: 2 });
      cursor = doc.y + 10;
    }

    if (gapsHeight) {
      doc.fontSize(8)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica-Bold')
         .text('GAPS', 60, cursor);
      cursor += 12;
      doc.fontSize(8)
         .fillColor('#000')
         .font('Helvetica')
         .text(gapsText, 60, cursor, { width: 470, align: 'left', lineGap: 2 });
      cursor = doc.y + 10;
    }

    if (evidenceHeight) {
      doc.fontSize(8)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica-Bold')
         .text('EVIDENCE (PLANNED VS EXECUTED)', 60, cursor);
      cursor += 18;
      const tableHeight = this._drawFidelityEvidenceTable(doc, evidenceItems, 60, cursor, columnWidths);
      cursor += tableHeight + 10;
    }

    return yPos + detailBoxHeight + 20;
  }

  /**
   * Estimate table height for fidelity evidence (used for pagination)
   * @private
   */
  static _estimateFidelityEvidenceHeight(doc, items, columnWidths) {
    if (!items.length) {
      return 0;
    }

    const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
    let height = 12; // header height + rule

    items.forEach((item) => {
      const aspect = item.aspect || 'Aspect';
      const planned = item.planned || 'N/A';
      const executed = [
        item.executed || 'N/A',
        item.timestamp ? `(Timestamp: ${item.timestamp})` : ''
      ]
        .filter(Boolean)
        .join('\n');

      doc.fontSize(7).font('Helvetica-Bold');
      const aspectHeight = doc.heightOfString(aspect, { width: columnWidths[0], lineGap: 2 });
      doc.font('Helvetica-Oblique');
      const plannedHeight = doc.heightOfString(`"${planned}"`, { width: columnWidths[1], lineGap: 2 });
      doc.font('Helvetica');
      const executedHeight = doc.heightOfString(executed, { width: columnWidths[2], lineGap: 2 });

      const rowHeight = Math.max(aspectHeight, plannedHeight, executedHeight) + 8;
      height += rowHeight;
    });

    // Reset font and add padding underneath table
    doc.font('Helvetica');
    return height + 5;
  }

  /**
   * Draw three-column fidelity evidence table
   * @private
   */
  static _drawFidelityEvidenceTable(doc, items, x, y, columnWidths) {
    const [aspectWidth, plannedWidth, executedWidth] = columnWidths;
    const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
    let currentY = y;

    // Header
    doc.fontSize(7)
       .fillColor('#000')
       .font('Helvetica-Bold')
       .text('Aspect', x, currentY, { width: aspectWidth, lineGap: 2 });
    doc.text('Planned', x + aspectWidth, currentY, { width: plannedWidth, lineGap: 2 });
    doc.text('Executed', x + aspectWidth + plannedWidth, currentY, { width: executedWidth, lineGap: 2 });

    const headerBottom = currentY + doc.heightOfString('Aspect', { width: aspectWidth, lineGap: 2 }) + 4;
    doc.moveTo(x, headerBottom)
       .lineTo(x + totalWidth, headerBottom)
       .strokeColor(this.COLORS.border)
       .lineWidth(0.5)
       .stroke()
       .lineWidth(1);

    currentY = headerBottom + 4;

    items.forEach((item) => {
      const aspect = this._formatFidelityAspect(item.aspect);
      const planned = item.planned || 'N/A';
      const executed = [
        item.executed || 'N/A',
        item.timestamp ? `(Timestamp: ${item.timestamp})` : ''
      ]
        .filter(Boolean)
        .join('\n');

      doc.fontSize(7).font('Helvetica-Bold').fillColor('#000');
      const aspectHeight = doc.heightOfString(aspect, { width: aspectWidth, lineGap: 2 });
      doc.text(aspect, x, currentY, { width: aspectWidth, lineGap: 2 });

      doc.font('Helvetica-Oblique');
      const plannedHeight = doc.heightOfString(`"${planned}"`, { width: plannedWidth, lineGap: 2 });
      doc.text(`"${planned}"`, x + aspectWidth, currentY, { width: plannedWidth, lineGap: 2 });

      doc.font('Helvetica').fillColor('#000');
      const executedHeight = doc.heightOfString(executed, { width: executedWidth, lineGap: 2 });
      doc.text(executed, x + aspectWidth + plannedWidth, currentY, { width: executedWidth, lineGap: 2 });

      const rowHeight = Math.max(aspectHeight, plannedHeight, executedHeight) + 8;
      currentY += rowHeight;
    });

    doc.strokeColor(this.COLORS.border);
    doc.font('Helvetica');
    return currentY - y;
  }

  /**
   * Normalize aspect label for fidelity table
   * @private
   */
  static _formatFidelityAspect(aspect) {
    if (!aspect) {
      return 'Aspect';
    }
    return aspect
      .replace(/^\s*planned\s*/i, '')
      .replace(/\s*vs\.?\s*executed.*$/i, '')
      .replace(/\s*vs\s+implemented.*$/i, '')
      .trim() || 'Aspect';
  }

  /**
   * Draw overall feedback section
   * @private
   */
  static _drawOverallFeedback(doc, feedback, yPos) {
    // Check if we need a new page
    if (yPos > 650) {
      doc.addPage();
      yPos = 50;
    }

    // Calculate feedback text height
    const feedbackText = feedback || 'No feedback provided.';
    const feedbackHeight = this._calculateTextHeight(doc, feedbackText, 9, 470, 2);

    // Build box height step by step
    let boxHeight = 30; // Header height (Overall Feedback title)
    boxHeight += feedbackHeight; // Actual feedback text height
    boxHeight += 12; // Bottom padding

    doc.roundedRect(50, yPos, 495, boxHeight, 8)
       .fillAndStroke(this.COLORS.background, this.COLORS.border);

    doc.fontSize(12)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text('Overall Feedback', 60, yPos + 10);

    // Route via _renderMixedText so an Urdu executive summary gets Naskh,
    // not Helvetica-mojibake.
    this._renderMixedText(doc, feedbackText, 60, yPos + 30, {
      width: 470, fontSize: 9, lineGap: 2, align: 'left',
    });

    return yPos + boxHeight + 20;
  }

  /**
   * Draw Debrief & Reflection section
   * @private
   */
  static _drawDebriefReflection(doc, debriefReflection, yPos) {
    // Check if we need a new page
    if (yPos > 650) {
      doc.addPage();
      yPos = 50;
    }

    doc.fontSize(18)
       .fillColor(this.COLORS.primary)
       .font('Helvetica-Bold')
       .text('Debrief & Reflection', 50, yPos);

    yPos += 30;

    // Score summary box
    doc.roundedRect(50, yPos, 495, 40, 8)
       .fillAndStroke(this.COLORS.background, this.COLORS.border);

    doc.fontSize(10)
       .fillColor(this.COLORS.secondary)
       .font('Helvetica')
       .text('TOTAL SCORE', 60, yPos + 10);

    doc.fontSize(12)
       .fillColor('#000')
       .font('Helvetica-Bold')
       .text(`${debriefReflection.score}/${debriefReflection.maxScore}`, 60, yPos + 25);

    // Progress bar for debrief section
    const debriefPct = debriefReflection.maxScore > 0
      ? Math.round((debriefReflection.score / debriefReflection.maxScore) * 100)
      : 0;
    const debriefBarColor = this._barColor(debriefPct, doc._colorBins);
    this._drawRoundedProgressBar(doc, 200, yPos + 25, 300, 10, debriefPct, debriefBarColor);

    yPos += 55;

    // Render each criterion
    for (const criterion of debriefReflection.criteria || []) {
      // Check if we need a new page
      if (yPos > 680) {
        doc.addPage();
        yPos = 50;
      }

      // Calculate heights for dynamic box
      const evidenceText = criterion.evidence || '';
      const justificationText = criterion.justification || '';

      // Build box height step by step
      let boxHeight = 28; // Header (criterion name + score)

      let evidenceHeight = 0;
      if (evidenceText) {
        boxHeight += 18; // EVIDENCE label space
        evidenceHeight = this._calculateTextHeight(doc, evidenceText, 7, 470, 2);
        boxHeight += evidenceHeight; // Actual evidence text height
      }

      if (justificationText) {
        boxHeight += 18; // JUSTIFICATION label space
        const justificationHeight = this._calculateTextHeight(doc, justificationText, 7, 380, 2);
        boxHeight += justificationHeight; // Actual justification text height
      }

      boxHeight += 12; // Bottom padding

      // Criterion box with dynamic height
      doc.roundedRect(50, yPos, 495, boxHeight, 8)
         .fillAndStroke(this.COLORS.background, this.COLORS.border);

      doc.fontSize(9)
         .fillColor('#000')
         .font('Helvetica-Bold')
         .text(criterion.name, 60, yPos + 10);

      doc.fontSize(9)
         .fillColor(this.COLORS.secondary)
         .font('Helvetica')
         .text(`${criterion.score}/${criterion.max}`, 480, yPos + 10);

      let currentY = yPos + 28;

      // Evidence section
      if (criterion.evidence) {
        doc.fontSize(7)
           .fillColor(this.COLORS.secondary)
           .font('Helvetica')
           .text('EVIDENCE', 60, currentY);

        this._renderMixedText(doc, criterion.evidence, 60, currentY + 18, {
          width: 470,
          fontSize: 7,
          lineGap: 2
        });

        currentY += 18 + evidenceHeight;
      }

      // Justification section (if provided)
      if (criterion.justification) {
        doc.fontSize(7)
           .fillColor(this.COLORS.secondary)
           .font('Helvetica')
           .text('JUSTIFICATION', 60, currentY);

        doc.fontSize(7)
           .fillColor('#000')
           .font('Helvetica')
           .text(criterion.justification, 150, currentY, {
             width: 380,
             lineGap: 2
           });
      }

      yPos += boxHeight + 10;
    }

    return yPos + 10;
  }

  /**
   * Draw footer on the last content page — kept for backwards compatibility
   * with any external caller still invoking it directly. New reports use
   * _drawPageFooters (per-page footer with page numbers).
   * @private
   */
  static _drawFooter(doc, yPos) {
    doc.fontSize(7)
       .fillColor(this.COLORS.secondary)
       .text(`Generated by Rumi • Supporting teachers everywhere • ${new Date().toLocaleDateString()}`, 50, yPos, {
         width: 495,
         align: 'center'
       });
  }

  /**
   * Per-page footer with page numbers + provenance. Called AFTER all content
   * is placed (with `bufferPages: true`) so total page count is known.
   * @private
   */
  static _drawPageFooters(doc, reportData) {
    const range = doc.bufferedPageRange(); // { start, count }
    const total = range.count;
    const dateStr = new Date().toLocaleDateString();
    const fwLabel = (reportData.framework || '').toUpperCase();
    const teacher = reportData.teacherName || '';
    const provenance = [fwLabel, teacher, dateStr].filter(Boolean).join(' · ');

    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      // A4 is ~842pt tall. Drawing near the page bottom triggers PDFKit's
      // auto-pagination unless we temporarily zero the bottom margin — miss
      // this and every footer.text() call phantom-adds a page (loop runs
      // `total` times over an ever-growing buffer, producing ~2× blank pages).
      const originalBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 30;
      doc.moveTo(50, y - 6).lineTo(545, y - 6)
         .strokeColor(this.COLORS.border).lineWidth(0.5).stroke().lineWidth(1);
      doc.fontSize(7).fillColor(this.COLORS.secondary).font('Helvetica')
         .text(provenance, 50, y, { width: 400, align: 'left', lineBreak: false });
      doc.fontSize(7).fillColor(this.COLORS.secondary).font('Helvetica')
         .text(`Rumi · Page ${i + 1} of ${total}`, 350, y, { width: 195, align: 'right', lineBreak: false });
      doc.page.margins.bottom = originalBottom;
    }
  }

  /**
   * Save PDF buffer to file (for testing/debugging)
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} filename - Output filename
   * @returns {Promise<string>} File path
   */
  static async savePDF(pdfBuffer, filename) {
    const filePath = path.join(TEMP_DIR, filename);
    fs.writeFileSync(filePath, pdfBuffer);
    logToFile('PDF saved to file', { filePath, sizeKB: Math.round(pdfBuffer.length / 1024) });
    return filePath;
  }

  /**
   * MEWAKA report renderer. Uses Playwright (shared/utils/html-to-pdf.js) to
   * render the hero focus area + 6-domain Swahili scorecard + inline SVG
   * sparkline as HTML→PDF. Kept separate from the pdfkit path so non-MEWAKA
   * frameworks never pull Playwright.
   */
  static async _generateMEWAKAReport(reportData, startTime) {
    try {
      logToFile('Starting MEWAKA PDF report generation (Playwright)', {
        teacher: reportData.teacherName,
        totalScore: reportData.totalScore,
        maxScore: reportData.maxScore,
        framework: reportData.framework,
        language: reportData.language,
      });

      // Lazy-require so the pdfkit path doesn't pull Playwright dependencies.
      const { renderMewakaReportHtml } = require('./coaching/templates/mewaka-report.template');
      const { htmlToPdf } = require('../utils/html-to-pdf');

      const html = renderMewakaReportHtml(reportData);
      const pdfBuffer = await htmlToPdf(html, {
        format: 'A4',
        // Match the template's @page margins (11mm 14mm) so the 1-page layout
        // holds — a hardcoded value here would override @page and re-overflow.
        margin: { top: '11mm', right: '14mm', bottom: '11mm', left: '14mm' },
        printBackground: true,
      });

      logToFile('MEWAKA PDF report generated', {
        teacher: reportData.teacherName,
        pdfSizeKB: Math.round(pdfBuffer.length / 1024),
        durationMs: Date.now() - startTime,
      });

      return pdfBuffer;
    } catch (error) {
      logToFile('❌ Failed to generate MEWAKA PDF report', {
        teacher: reportData.teacherName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}

module.exports = PDFReportService;
