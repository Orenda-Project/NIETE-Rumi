---
name: reading-assessment
description: Oral-reading-fluency assessment (EGRA/ASER-style) — the passage→record→transcribe→score pipeline, WCPM benchmarks, multilingual rules, and debugging.
---

# Reading Assessment Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [coaching](../coaching/SKILL.md), [debugging](../debugging/SKILL.md)

A teacher runs a student through a short oral-reading assessment: the bot generates a passage, the student
reads it aloud, and the bot transcribes the audio, scores fluency against grade benchmarks, and returns a
report with voice feedback.

## Quick Reference

- **Orchestration**: [bot/shared/services/reading-assessment.service.js](../../../bot/shared/services/reading-assessment.service.js).
- **Pipeline stages**: [bot/shared/services/reading/](../../../bot/shared/services/reading/) — `passage-generation`, `transcription`, `pronunciation`, `fluency`, `analysis`, `comprehension`, `report`, `voice-feedback`.
- **Report template**: [bot/shared/templates/reading-report.template.js](../../../bot/shared/templates/reading-report.template.js).
- **Entry**: a `/reading` command routed through [bot/shared/handlers/text-message.handler.js](../../../bot/shared/handlers/text-message.handler.js).

## Domain Knowledge

### Methodology

EGRA/ASER-style **Oral Reading Fluency (ORF)** assessment. Primary metric is **WCPM** (Words Correct Per
Minute); alphabet assessments use **LCPM** (Letters Correct Per Minute). Passage types scale by difficulty:
letters → words → sentences → paragraphs → story.

### The pipeline

1. Teacher submits student details (name, grade, language, mode) via a Flow, then picks reading level + scope.
2. A passage is generated for the target level by [reading/passage-generation.service.js](../../../bot/shared/services/reading/passage-generation.service.js) (LLM, with diversity controls so passages don't repeat).
3. A reading grid PDF is produced.
4. Student records → audio transcribed in [reading/transcription.service.js](../../../bot/shared/services/reading/transcription.service.js).
5. (English) pronunciation scored in [reading/pronunciation.service.js](../../../bot/shared/services/reading/pronunciation.service.js); other languages fall back to LLM analysis.
6. Levenshtein alignment of transcript vs passage → error detection → WCPM.
7. WCPM compared to benchmarks in [reading/analysis.service.js](../../../bot/shared/services/reading/analysis.service.js) (`compareToBenchmarks` → the `check_benchmark_status` RPC) → report + voice feedback.

### `grade_level`

`grade_level` is the difficulty proxy (0 = letters … up to story) and drives both passage generation and the
benchmark lookup. The benchmark RPC `check_benchmark_status(p_wcpm, p_grade, p_language, p_is_l2)` returns
`(benchmark_min, benchmark_max, on_track, percentile_rank)`, reading from the `wcpm_percentiles` table
(25th percentile = min, 75th = max; season auto-derived from the current month).

### Assessment-language rule

Once the teacher picks the assessment language, **every** bot-generated string for the rest of that
assessment must be in *that* language — not the user's stored `preferred_language`. The welcome message
before the pick still uses the user's language. Pin each prompt with an explicit
`MUST be written entirely in language code "${lang}"`, because the model otherwise drifts back to the
default. (Comprehension answers are preserved verbatim for non-English; the report renderer handles RTL +
Nastaliq natively.)

### Language support

| Language | Pronunciation scoring | Benchmarks |
|----------|----------------------|------------|
| English | Full (provider-based) | Hasbrouck-Tindal ORF norms |
| Urdu | LLM fallback (no provider scoring) | L2-adjusted (~70% of EN; recalibrate after enough production data) |
| Arabic | LLM fallback, RTL | L2-adjusted |
| Others | LLM fallback | extrapolated |

RTL languages (Urdu/Arabic) render grids right-to-left with reversed letter order and direction indicators.

### Benchmark labels (EGRA convention)

| Comprehension score | Label |
|---------------------|-------|
| ≥ 80% | On Track |
| 60–79% | Approaching Benchmark |
| < 60% | Needs Support |

Performance tiers off the fluency percentile: ≥75 Excellent · on-track & ≥50 Proficient · on-track
Developing · else Emerging — applied identically in the HTML template and the legacy renderer so both look
consistent.

## Common Issues & Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| Voice feedback has nonsensical corrections | Transcript not cleaned (diarization labels left in) | Clean the transcript before word alignment. |
| Only one comprehension question asked | Voice routing priority wrong (reading handler before comprehension) | Check routing order in [voice-message.handler.js](../../../bot/shared/handlers/voice-message.handler.js). |
| Repetitive passages | No diversity controls in the prompt | Use the theme/name/avoid arrays in passage generation. |
| Wrong benchmark | Grade/language/L2 args mismatched | Confirm the `check_benchmark_status` args; trace the correlation id — see [debugging](../debugging/SKILL.md). |

## Example — WCPM

```js
const correctWords = passageWords.filter((w, i) =>
  transcriptWords[i]?.toLowerCase() === w.toLowerCase()).length;
const wcpm = (correctWords / (durationSeconds / 60)).toFixed(1);
```

## Related Skills

- [coaching](../coaching/SKILL.md) — shares the LLM-analysis + report-generation patterns.
- [debugging](../debugging/SKILL.md) — investigate a stuck or wrong assessment by correlation id.
