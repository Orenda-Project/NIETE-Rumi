require('dotenv').config();

const pdf = require('pdf-parse');
const { modelFor } = require('../shared/config/model-registry');
const mammoth = require('mammoth');
const { getClient } = require('../shared/services/llm-client');
const { jsonrepair } = require('jsonrepair');

const supabase = require('../shared/config/supabase');
const { logToFile, logError } = require('../shared/utils/logger');
const { downloadFromR2, uploadLessonPlanBuffer, buildR2PublicUrl } = require('../shared/storage/r2');
const { AWSTextractService } = require('../shared/services/aws-textract.service');
const { OPENAI_API_KEY } = require('../shared/utils/constants');
const WhatsAppService = require('../shared/services/whatsapp.service');
const { isLikelyLessonPlan } = require('../shared/services/coaching/lesson-plan-classifier');
const { getCoachingMessage } = require('../shared/config/coaching-messages');

// bd-0wws3e — Postgres cannot store \u0000 in text or jsonb; one NUL fails the whole row update.
const stripNul = (s) => (typeof s === 'string' ? s.replace(/\u0000/g, '') : s);
function stripNulDeep(v) {
  if (typeof v === 'string') return stripNul(v);
  if (Array.isArray(v)) return v.map(stripNulDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripNulDeep(x)]));
  }
  return v;
}

class LessonPlanExtractionWorker {
  static openai = null;

  static getOpenAI() {
    if (!this.openai) {
      this.openai = getClient();
    }
    return this.openai;
  }

  static async process(jobData) {
    const { coachingSessionId, r2Key, fileType, userId: jobUserId, pastedText } = jobData;

    // bd-we73k — the teacher PASTED her plan into the chat. There is no file to
    // fetch and nothing to OCR: the text IS the extraction result. Everything
    // downstream of this point (structuring, isLikelyLessonPlan, the completed
    // payload, the fidelity recompute) is shared with the upload path on
    // purpose — a second copy of that logic is how the two drift apart.
    const isPaste = typeof pastedText === 'string' && pastedText.trim().length > 0;

    try {
      logToFile('📄 Starting lesson plan extraction', {
        coachingSessionId,
        r2Key,
        fileType,
        source: isPaste ? 'pasted_text' : 'file'
      });

      const { data: sessionRecord, error: sessionError } = await supabase
        .from('coaching_sessions')
        .select('user_id, lesson_plan_url, lesson_plan_r2_key, lesson_plan_format')
        .eq('id', coachingSessionId)
        .single();

      if (sessionError) {
        throw sessionError;
      }

      const sessionUserId = jobUserId || sessionRecord?.user_id;
      const fileBuffer = isPaste ? null : await downloadFromR2(r2Key);
      const detectedType = isPaste ? 'text' : (this.detectFileType(fileBuffer) || fileType || 'pdf');

      let normalizedKey = r2Key;
      let normalizedUrl = sessionRecord?.lesson_plan_url || null;
      let normalizedFormat = detectedType;
      let normalized = false;

      if (!isPaste && fileType?.toLowerCase() !== detectedType.toLowerCase()) {
        if (!sessionUserId) {
          logToFile('⚠️ Lesson plan format mismatch but user_id unavailable; skipping normalization', {
            coachingSessionId,
            queuedType: fileType,
            detectedType
          });
        } else {
          normalizedKey = await uploadLessonPlanBuffer({
            buffer: fileBuffer,
            userId: sessionUserId,
            sessionId: coachingSessionId,
            fileType: detectedType
          });
          normalizedUrl = buildR2PublicUrl(normalizedKey);
          normalized = true;
          logToFile('🔁 Lesson plan normalized to detected file type', {
            coachingSessionId,
            previousKey: r2Key,
            newKey: normalizedKey,
            detectedType
          });
        }
      }

      // bd-0wws3e — our own LP: link the library lesson it names and stop. Fidelity
      // then scores it exactly as if the coach had picked it from the list.
      const corpusRef = !isPaste && String(detectedType).toLowerCase() === 'pdf'
        ? await this.corpusRefFromPdf(fileBuffer, coachingSessionId)
        : null;
      if (corpusRef) {
        const corpusPayload = {
          has_lesson_plan: true,
          lesson_plan_structured: { _fidelity_ref: corpusRef },
          lesson_plan_extraction_status: 'completed',
          lesson_plan_extraction_error: null,
          lesson_plan_format: normalizedFormat
        };
        if (normalized) {
          corpusPayload.lesson_plan_r2_key = normalizedKey;
          corpusPayload.lesson_plan_url = normalizedUrl;
        } else if (!sessionRecord?.lesson_plan_r2_key) {
          corpusPayload.lesson_plan_r2_key = normalizedKey;
        }
        await this.saveSession(coachingSessionId, corpusPayload, 'corpus_link');
        logToFile('✅ Lesson plan linked to corpus lesson from PDF metadata', {
          coachingSessionId, lessonId: corpusRef.lesson_id, versionStamp: corpusRef.version_stamp
        });
        await LessonPlanExtractionWorker.maybeRecomputeFidelity(coachingSessionId);
        return;
      }

      let { text: extractedText, parser: parserUsed } = isPaste
        ? { text: pastedText.trim(), parser: 'pasted_text' }
        : await this.extractText(fileBuffer, detectedType);
      logToFile('Lesson plan text extracted', {
        coachingSessionId,
        detectedType,
        parserUsed,
        textLength: extractedText?.length || 0
      });

      let structuredData = await this.structureText(extractedText, coachingSessionId, detectedType);

      // bd-fe35j9 — a typed Urdu PDF has a text layer, so pdf-parse "succeeds",
      // but the Urdu comes out as broken glyphs and NUL bytes and the parser
      // calls it not-a-lesson-plan. Before telling the teacher that, read the
      // FILE once through the vision model, which reads the page as rendered.
      if (isLikelyLessonPlan(structuredData) === false
          && LessonPlanExtractionWorker.canRetryWithVision({ isPaste, detectedType, parserUsed })) {
        const retry = await this.readWithVision(fileBuffer, detectedType, coachingSessionId);
        if (retry) {
          const retryStructured = await this.structureText(retry.text, coachingSessionId, detectedType);
          const accepted = isLikelyLessonPlan(retryStructured) === true;
          logToFile('Lesson plan vision re-read after not-LP verdict', {
            coachingSessionId,
            firstParser: parserUsed,
            textLength: retry.text.length,
            accepted
          });
          if (accepted) {
            extractedText = retry.text;
            parserUsed = retry.parser;
            structuredData = retryStructured;
          }
        }
      }

      const excerpt = this.createSafeExcerpt(extractedText, 500);
      const wordCount = extractedText ? extractedText.split(/\s+/).filter(Boolean).length : 0;

      // Guard against a non-lesson-plan document (a leave letter, a
      // notice) being silently accepted as a plan. If the parsed content shows
      // no lesson-plan signal, tell the teacher quickly and don't attach it —
      // the classroom-audio analysis still proceeds without an LP.
      if (isLikelyLessonPlan(structuredData) === false) {
        await this.saveSession(coachingSessionId, {
          lesson_plan_excerpt: excerpt,
          lesson_plan_structured: null,
          lesson_plan_word_count: wordCount,
          has_lesson_plan: false,
          lesson_plan_extraction_status: 'not_lesson_plan',
          lesson_plan_extraction_error: null,
          lesson_plan_format: normalizedFormat
        }, 'not_lesson_plan');
        await this.notifyNotLessonPlan(coachingSessionId);
        logToFile('🚫 Uploaded document is not a lesson plan — skipped attaching', {
          coachingSessionId,
          subject: structuredData?.subject || null,
          wordCount
        });
        return;
      }

      const updatePayload = LessonPlanExtractionWorker.buildCompletedPayload({
        excerpt,
        structuredData,
        wordCount,
        extractedText,
        normalizedFormat
      });

      // A paste has no R2 object; writing a key/url for one would point at
      // nothing. Only the file path may touch those columns.
      if (isPaste) {
        // nothing to reconcile
      } else if (normalized) {
        updatePayload.lesson_plan_r2_key = normalizedKey;
        updatePayload.lesson_plan_url = normalizedUrl;
      } else if (!sessionRecord?.lesson_plan_r2_key) {
        updatePayload.lesson_plan_r2_key = normalizedKey;
      }

      await this.saveSession(coachingSessionId, updatePayload, 'completed');

      logToFile('✅ Lesson plan extraction complete', {
        coachingSessionId,
        parserUsed,
        excerptLength: excerpt?.length || 0,
        wordCount
      });

      // bd-5knlj: extraction can land AFTER the analysis that was queued at
      // upload time — the uploaded plan then never reached the fidelity engine
      // and Section B stayed on its fallback. Recompute is CAS-guarded to
      // unsubmitted-review statuses and a no-op when fidelity is already ok.
      await LessonPlanExtractionWorker.maybeRecomputeFidelity(coachingSessionId);
    } catch (error) {
      const sanitizedError = (error.message || 'Unknown error')
        .replace(/\/[^\/\s]+/g, '[path]')
        .substring(0, 200);

      const isFormatError =
        /unsupported document format/i.test(error.message || '') ||
        /invalid pdf structure/i.test(error.message || '');

      await this.saveSession(coachingSessionId, {
        lesson_plan_extraction_status: isFormatError ? 'failed_bad_format' : 'failed',
        lesson_plan_extraction_error: sanitizedError
      }, 'failed');

      if (isFormatError) {
        await this.notifyFormatIssue(coachingSessionId);
      }

      logToFile('❌ Lesson plan extraction failed', {
        coachingSessionId,
        error: error.message
      });
      throw error;
    }
  }

  // bd-dflr7 — carry the FULL extracted text as lesson_plan_text (not just the
  // 500-char excerpt) so the uploaded-LP fidelity path (which reads
  // coaching_sessions.lesson_plan_text) can grade an uploaded plan.
  /** bd-5knlj — fire the late-LP fidelity recompute; never throws. */
  static async maybeRecomputeFidelity(coachingSessionId, deps = {}) {
    const recompute = deps.recompute
      || ((sid) => require('../shared/services/coaching/fidelity/fidelity-recompute.service')
        .recomputeFidelityForSession(sid));
    try {
      return await recompute(coachingSessionId);
    } catch (e) {
      logToFile('[fidelity-recompute] post-extraction hook failed (non-blocking)', {
        coachingSessionId, error: e.message,
      });
      return { recomputed: false, reason: 'error' };
    }
  }

  /** Parse extracted text into the LP schema with every array defaulted; null when too short or unparseable. */
  static async structureText(text, coachingSessionId, detectedType) {
    if (!text || text.length < 50) {
      logToFile('⚠️ Lesson plan text insufficient for structured parsing', {
        coachingSessionId,
        detectedType,
        textLength: text?.length || 0
      });
      return null;
    }
    const structuredData = await this.parseWithGPT4oMini(text);
    if (!structuredData) {
      logToFile('⚠️ Lesson plan structured data parsing returned null', {
        coachingSessionId,
        textSample: text.substring(0, 200)
      });
      return null;
    }
    structuredData.objectives = structuredData.objectives || [];
    structuredData.prior_knowledge = structuredData.prior_knowledge || [];
    structuredData.materials = structuredData.materials || [];
    structuredData.resources_detail = structuredData.resources_detail || [];
    structuredData.assessment_methods = structuredData.assessment_methods || [];
    structuredData.assessment_protocols = structuredData.assessment_protocols || [];
    structuredData.activities = structuredData.activities || [];
    structuredData.annexures = structuredData.annexures || [];
    structuredData.assessment_sequences = structuredData.assessment_sequences || [];
    structuredData.textbook_references = structuredData.textbook_references || [];
    structuredData.planned_questions = structuredData.planned_questions || [];
    structuredData.resource_pages = structuredData.resource_pages || [];
    logToFile('Lesson plan structured data parsed', {
      coachingSessionId,
      objectiveCount: structuredData.objectives.length,
      priorKnowledgeEntries: structuredData.prior_knowledge.length,
      materialsCount: structuredData.materials.length,
      assessmentSequences: structuredData.assessment_sequences.length
    });
    return structuredData;
  }

  /** bd-fe35j9 — only a PDF or image file the vision model has not already read gets a second read. */
  static canRetryWithVision({ isPaste, detectedType, parserUsed }) {
    if (isPaste) return false;
    if (String(parserUsed || '').startsWith('vision:')) return false;
    return ['pdf', 'png', 'jpg', 'jpeg'].includes(String(detectedType || '').toLowerCase());
  }

  /** bd-fe35j9 — read the file through the vision model; null when it yields nothing. Never throws. */
  static async readWithVision(buffer, detectedType, coachingSessionId) {
    const visionOcr = require('../shared/services/lp-vision-ocr.service');
    const lowerType = String(detectedType || '').toLowerCase();
    try {
      const text = lowerType === 'pdf'
        ? await visionOcr.extractTextFromPdf(buffer)
        : await visionOcr.extractTextFromImage(buffer, `image/${lowerType === 'jpg' ? 'jpeg' : lowerType}`);
      const trimmed = (text || '').trim();
      return trimmed.length >= 20 ? { text: trimmed, parser: 'vision:not_lp_retry' } : null;
    } catch (err) {
      logToFile('Lesson plan vision re-read failed (keeping first verdict)', { coachingSessionId, error: err.message });
      return null;
    }
  }

  /** bd-0wws3e — the worker's one coaching_sessions writer: strips NUL bytes and logs a failed save. */
  static async saveSession(coachingSessionId, payload, step) {
    const { error } = await supabase
      .from('coaching_sessions')
      .update(stripNulDeep(payload))
      .eq('id', coachingSessionId);
    if (error) {
      logError('❌ Lesson plan save failed', {
        coachingSessionId, step, code: error.code || null, error: error.message || String(error)
      });
    }
    return error || null;
  }

  /**
   * bd-0wws3e — our own NIETE LP PDFs carry `lesson_id=…` in their Subject. When that
   * lesson is in niete_lp_assets, return the corpus ref the list-pick path writes, so
   * fidelity scores it from the library: no parse, no vision. Null otherwise. Never throws.
   */
  static async corpusRefFromPdf(buffer, coachingSessionId) {
    try {
      const { info } = await pdf(buffer, { max: 1 });
      const m = String((info && info.Subject) || '').match(/lesson_id=([A-Za-z0-9_]+)/);
      if (!m) return null;
      const lessonId = m[1].toLowerCase();
      const { data, error } = await supabase
        .from('niete_lp_assets')
        .select('id, lesson_id, version_stamp, content_hash')
        .eq('lesson_id', lessonId)
        .order('created_at', { ascending: false })
        .limit(1);
      const row = !error && Array.isArray(data) ? data[0] : null;
      logToFile('Lesson plan PDF carries a corpus lesson_id', { coachingSessionId, lessonId, inLibrary: !!row });
      if (!row) return null;
      const { parseCorpusLessonId } = require('../shared/services/coaching/subject-resolution');
      const parsed = parseCorpusLessonId(row.lesson_id);
      return {
        lesson_id: row.lesson_id,
        version_stamp: row.version_stamp,
        content_hash: row.content_hash,
        subject: parsed ? parsed.subject : null,
        grade: parsed ? parsed.grade : null,
      };
    } catch (err) {
      logToFile('Lesson plan corpus lookup skipped', { coachingSessionId, error: err.message });
      return null;
    }
  }

  static buildCompletedPayload({ excerpt, structuredData, wordCount, extractedText, normalizedFormat }) {
    return {
      lesson_plan_excerpt: excerpt,
      lesson_plan_structured: structuredData,
      lesson_plan_word_count: wordCount,
      lesson_plan_text: extractedText || null,
      lesson_plan_extraction_status: 'completed',
      lesson_plan_extraction_error: null,
      lesson_plan_format: normalizedFormat
    };
  }

  static async extractText(buffer, fileType) {
    if (!buffer) {
      return { text: '', parser: 'none' };
    }

    const lowerType = (fileType || '').toLowerCase();

    // bd-o1m1m — scanned/image LP PDFs (no text layer, multi-page) OR photo uploads
    // are read by a vision model, NOT Textract: Textract's sync AnalyzeDocument rejects
    // multi-page PDFs ("unsupported document format") and cannot read Urdu at all.
    // Textract stays as a last-resort fallback if vision yields nothing.
    const visionOcr = require('../shared/services/lp-vision-ocr.service');
    const textractFallback = async (reason) => {
      const isImage = lowerType === 'png' || lowerType === 'jpg' || lowerType === 'jpeg';
      try {
        logToFile('Lesson plan OCR via vision model', { reason, fileType: lowerType, model: visionOcr.visionModel() });
        const text = isImage
          ? await visionOcr.extractTextFromImage(buffer, `image/${lowerType === 'jpg' ? 'jpeg' : lowerType}`)
          : await visionOcr.extractTextFromPdf(buffer);
        if (text && text.trim().length >= 20) {
          return { text: text.trim(), parser: `vision:${reason}` };
        }
        logToFile('Lesson plan vision OCR returned little text, trying Textract', { reason, textLength: text ? text.length : 0 });
      } catch (err) {
        logToFile('Lesson plan vision OCR failed, trying Textract', { reason, error: err.message });
      }
      try {
        const textractText = await AWSTextractService.extractText(buffer);
        return { text: textractText?.trim() || '', parser: `textract:${reason}` };
      } catch (terr) {
        logToFile('Lesson plan Textract fallback also failed', { reason, error: terr.message });
        return { text: '', parser: `failed:${reason}` };
      }
    };

    if (lowerType === 'pdf') {
      try {
        const result = await pdf(buffer);
        const text = (result.text || '').trim();
        // bd-0wws3e — Urdu PDFs come back from pdf-parse as broken glyphs laced with
        // NUL bytes. That text is unreadable (and unsavable), so read the page instead.
        if (text.includes('\u0000')) {
          const viaVision = await textractFallback('pdf_nul_text');
          if (viaVision.text) return viaVision;
          return { text: stripNul(text).trim(), parser: 'pdf-parse:nul_stripped' };
        }
        if (text.length >= 50) {
          logToFile('Lesson plan PDF parsed via pdf-parse', { textLength: text.length });
          return { text, parser: 'pdf-parse' };
        }
        return await textractFallback('pdf_low_text');
      } catch (error) {
        logToFile('Lesson plan PDF parsing failed, falling back to Textract', { error: error.message });
        return await textractFallback('pdf_parse_error');
      }
    }

    if (lowerType === 'docx' || lowerType === 'doc') {
      try {
        const result = await mammoth.extractRawText({ buffer });
        const text = (result.value || '').trim();
        if (text.length >= 50) {
          logToFile('Lesson plan DOC/DOCX parsed via mammoth', { textLength: text.length });
          return { text, parser: 'mammoth' };
        }
        logToFile('Lesson plan DOC/DOCX produced little text, falling back to Textract', { textLength: text.length });
        return await textractFallback('doc_low_text');
      } catch (error) {
        logToFile('DOC extraction failed, falling back to Textract', { error: error.message });
        return await textractFallback('doc_exception');
      }
    }

    if (lowerType === 'png' || lowerType === 'jpg' || lowerType === 'jpeg') {
      return await textractFallback('image');
    }

    // Default to PDF parser with Textract fallback
    try {
      const fallback = await pdf(buffer);
      const text = (fallback.text || '').trim();
      if (text.length >= 50) {
        logToFile('Lesson plan default parser treated as PDF', { textLength: text.length });
        return { text, parser: 'pdf-parse-default' };
      }
      return await textractFallback('default_low_text');
    } catch (error) {
      logToFile('Default PDF parser failed, invoking Textract fallback', { error: error.message });
      return await textractFallback('default_parse_error');
    }
  }

  static createSafeExcerpt(text, maxLength) {
    if (!text) return null;
    if (text.length <= maxLength) return text;

    let end = maxLength;
    const charCode = text.charCodeAt(end - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      end--;
    }

    const lastSpace = text.lastIndexOf(' ', end);
    if (lastSpace > maxLength - 50) {
      end = lastSpace;
    }

    return `${text.substring(0, end)}...`;
  }

  static async parseWithGPT4oMini(rawText) {
    try {
      const client = this.getOpenAI();
      const truncated = this.safeTruncate(rawText, 12000);

      const prompt = `Extract structured lesson plan information from the following text. Return ONLY valid JSON.

First decide whether this document is actually a LESSON PLAN (teaching objectives, activities, materials, assessment for a class) versus something else the teacher sent by mistake (a leave/application letter, a notice, a memo, a blank form, an unrelated document). Set "is_lesson_plan" accordingly. If it is not a lesson plan, still return the JSON but leave the lesson-plan arrays empty.

DOCUMENT TEXT:
${truncated}

Return JSON with these fields:
{
  "objectives": [],
  "prior_knowledge": [],
  "materials": [],
  "resources_detail": [
    {
      "name": "",
      "description": "",
      "reference": "Annexure A / Page 4 / etc."
    }
  ],
  "assessment_methods": [],
  "assessment_protocols": [
    {
      "title": "",
      "instructions": "",
      "student_task": "",
      "teacher_moves": [],
      "reference": "Page or Annexure if mentioned"
    }
  ],
  "activities": [
    {
      "title": "",
      "time": "e.g., 5 min",
      "description": "",
      "reference": ""
    }
  ],
  "annexures": [
    {
      "title": "",
      "purpose": "",
      "description": ""
    }
  ],
  "assessment_sequences": [
    {
      "title": "",
      "steps": [],
      "materials": "",
      "expected_responses": "",
      "reference": "Page number / annexure if provided"
    }
  ],
  "textbook_references": [
    {
      "title": "",
      "page": "",
      "usage": ""
    }
  ],
  "planned_questions": [
    {
      "question": "",
      "intent": "",
      "expected_answer": "",
      "reference": ""
    }
  ],
  "resource_pages": [
    {
      "name": "",
      "page": "",
      "description": ""
    }
  ],
  "smart_analysis": {
    "specific": true/false,
    "measurable": true/false,
    "achievable": true/false,
    "relevant": true/false,
    "time_bound": true/false
  },
  "language": "en/ur",
  "grade_level": "",
  "subject": "",
  "topic": "",
  "is_lesson_plan": true/false,
  "objectives_found": true/false,
  "prior_knowledge_found": true/false,
  "materials_found": true/false,
  "assessment_found": true/false
}`;

      const response = await client.chat.completions.create({
        model: modelFor('lp.extractText'),
        job: 'lp.extractText',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1200
      });

      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = (jsonMatch ? jsonMatch[0] : content)?.trim();

      try {
        return JSON.parse(jsonString);
      } catch (parseError) {
        logToFile('⚠️ Lesson plan structured parsing JSON error, attempting repair', {
          error: parseError.message,
          preview: jsonString?.substring(0, 300)
        });
        try {
          const repaired = jsonrepair(jsonString);
          return JSON.parse(repaired);
        } catch (repairError) {
          logToFile('❌ Lesson plan structured parsing repair failed', {
            error: repairError.message,
            preview: jsonString?.substring(0, 300)
          });
          return null;
        }
      }
    } catch (error) {
      logToFile('⚠️ Lesson plan structured parsing failed', { error: error.message });
      return null;
    }
  }

  static safeTruncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    let end = maxLength;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xD800 && code <= 0xDBFF) {
      end--;
    }
    return text.substring(0, end);
  }

  static detectFileType(buffer) {
    if (!buffer || buffer.length < 4) {
      return 'pdf';
    }

    const bytes = buffer.subarray(0, 8);
    const hex = bytes.toString('hex');

    if (hex.startsWith('25504446')) {
      return 'pdf';
    }

    if (hex.startsWith('504b0304')) {
      return 'docx';
    }

    if (hex.startsWith('d0cf11e0')) {
      return 'doc';
    }

    if (hex.startsWith('ffd8ff')) {
      return 'jpg';
    }

    if (hex.startsWith('89504e47')) {
      return 'png';
    }

    return 'pdf';
  }

  static async notifyNotLessonPlan(coachingSessionId) {
    try {
      const { data, error } = await supabase
        .from('coaching_sessions')
        .select('id, observation_type, users:users(name, phone_number, preferred_language)')
        .eq('id', coachingSessionId)
        .single();

      // bd-fmf24g.66 — a COACH's observation has the TEACHER as its session user; the plan was the coach's
      // to attach, so the teacher is never told about it. The coach sees "Couldn't read" in the app.
      if (data && data.observation_type === 'leader_observation') {
        logToFile('ℹ️ Not-a-lesson-plan notice skipped: the plan was attached by the coach', { coachingSessionId });
        return;
      }

      if (error || !data?.users?.phone_number) {
        logToFile('⚠️ Unable to notify teacher that the document is not a lesson plan', {
          coachingSessionId,
          error: error?.message
        });
        return;
      }

      const lang = data.users.preferred_language || 'en';
      const message = getCoachingMessage('lessonPlan_notLessonPlan', lang);

      if (process.env.OFFLINE_REPLAY === 'true') {
        logToFile('ℹ️ Skipping not-a-lesson-plan notification (offline replay)', { coachingSessionId });
        return;
      }

      await WhatsAppService.sendMessage(data.users.phone_number, message);
      logToFile('📣 Notified teacher that the document is not a lesson plan', { coachingSessionId });
    } catch (notifyError) {
      logToFile('⚠️ Failed to send not-a-lesson-plan notification', {
        coachingSessionId,
        error: notifyError.message
      });
    }
  }

  static async notifyFormatIssue(coachingSessionId) {
    try {
      const { data, error } = await supabase
        .from('coaching_sessions')
        .select('id, observation_type, lesson_plan_format, users:users(name, phone_number)')
        .eq('id', coachingSessionId)
        .single();

      // bd-fmf24g.66 — see notifyNotLessonPlan: the teacher did not attach this file.
      if (data && data.observation_type === 'leader_observation') {
        logToFile('ℹ️ Unreadable-plan notice skipped: the plan was attached by the coach', { coachingSessionId });
        return;
      }

      if (error || !data?.users?.phone_number) {
        logToFile('⚠️ Unable to notify teacher about LP format issue', {
          coachingSessionId,
          error: error?.message
        });
        return;
      }

      const teacherName = (data.users.name || 'Teacher').trim();
      const message = `⚠️ ${teacherName}, I got your lesson plan but couldn’t read the file. It looks like the document was saved under the wrong format (for example, a Word file renamed as PDF). Please resend it as the original Word/DOCX file, a proper PDF export, or clear page photos so I can include it in your report.`;

      if (process.env.OFFLINE_REPLAY === 'true') {
        logToFile('ℹ️ Skipping teacher notification (offline replay)', { coachingSessionId, message });
        return;
      }

      await WhatsAppService.sendMessage(data.users.phone_number, message);
      logToFile('📣 Notified teacher about lesson plan format issue', { coachingSessionId });
    } catch (notifyError) {
      logToFile('⚠️ Failed to send LP format notification', {
        coachingSessionId,
        error: notifyError.message
      });
    }
  }
}

module.exports = LessonPlanExtractionWorker;

