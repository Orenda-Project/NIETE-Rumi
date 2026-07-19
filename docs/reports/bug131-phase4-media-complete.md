# Portal Training — Media Rendering Audit + Mark-Complete (Phase 4)

Branch: `portal-media-complete` · Scope: teacher-portal Training page (BUG-131 Phase 4)

## 1. Media audit — what actually rendered before this change

Audited against the live database (384 active `training_modules`) and the portal code path
(`dashboard/routes/portal.routes.js` GET `/training/module/:id` → `portal/src/portal/pages/PortalTraining.tsx`).

| Media type | Modules | Hosting | Rendered on portal before? |
|---|---|---|---|
| Video (R2-hosted `video_url`) | 132 | private R2 bucket | ✅ Yes — presigned, inline `<video>` |
| Video (externally-hosted public `video_url`) | 58 | public external object store | ❌ **No** — `generatePresignedUrl()` rejects non-R2 URLs and returns `null`, so the endpoint sent `video_url: null` and the player never rendered |
| Audio (`audio_url`, all R2) | 36 | private R2 bucket | ✅ Yes — presigned, inline `<audio>` |
| PDF document (`source_media_url` ending `.pdf`) | 155 | public external object store | ❌ **No** — the endpoint never selected `source_media_url`; these modules also have empty `content_html`, so all 155 rendered the "no readable content yet" fallback |
| `.mp4` in `source_media_url` | 58 | (same rows as external video above) | n/a — every one also has `video_url`, no separate gap |

Media totals: 190 modules with video, 36 with audio, 155 PDF-only. 0 modules with no content at all.
Both external-host URL classes were verified publicly reachable (HTTP 200, no auth) — the WhatsApp
side already delivers them as raw links/documents.

## 2. Completion-path audit

- Module completion = row in `teacher_training_progress` (`user_id`, `module_id`, `completed_at`),
  unique on (`user_id`, `module_id`). Written by the WhatsApp flow and by the portal quiz-submit
  endpoint (PR #7).
- **206 of 384 active modules have zero active `training_questions`** — one entire vendor's catalog
  (its 51 video + 155 PDF modules). Those modules had **no completion path on the portal at all**:
  no quiz to submit, no button, nothing.

## 3. Fixes

Backend (`dashboard/routes/portal.routes.js`):
- New `_resolveMediaUrl()` — presigns R2-hosted URLs, passes public external URLs through unchanged
  (this alone un-breaks the 58 externally-hosted videos).
- GET `/training/module/:id` now selects `source_media_url`, returns `pdf_url` (resolved) for
  document modules, and `has_questions` (existence probe on active `training_questions`).
- GET `/training/modules` list rows now carry `has_pdf`.
- New POST `/training/module/:id/complete` — "Mark complete" for quiz-less modules only:
  auth → level-lockdown gate → **409 if the module has any active questions** (completion must flow
  through quiz submit) → idempotent write of the same `teacher_training_progress` row shape the
  other two writers use (earliest completion wins; upsert on the unique constraint guards races).

Frontend (`portal/src/portal/pages/PortalTraining.tsx`) — additive edits only:
- PDF modules render an open control (icon card + "Open PDF" opens the document in a new tab).
- "No readable content" fallback now accounts for `pdf_url`.
- "Mark as complete" button shown only when `has_questions === false` and the module isn't already
  complete; success flips both the detail card and the module dropdown to completed without refetch.
  Modules with questions never see the button.

## 4. Tests

New suites (repo-root pattern, same mock harness as the existing portal training tests):
- `tests/training/portal-mark-complete.test.js` — 6 tests: 401 unauth, 400 bad id, 404 unknown
  module, 409 module-with-quiz (and writes nothing), happy-path row shape + `onConflict:
  'user_id,module_id'`, idempotent re-call returns existing timestamp and writes nothing.
- `tests/training/portal-module-media.test.js` — 6 tests: R2 video/audio presigned, external
  public video passed through unchanged (the regression), PDF `source_media_url` surfaced as
  `pdf_url` (external + R2 variants), `has_questions` true/false, list `has_pdf` flag.

Results:
- Full root suite: **1738 passed / 28 failed — the 28 failures are identical to a clean `main`
  checkout** (verified by diffing failing-suite lists and per-guard offender lists; they are
  local-environment and pre-existing issues: bot deps not installed for 4 suites, fork-banner
  content in the repo's own top-level agent doc, and 8 pre-existing column-guard offenders in
  curriculum tables). This branch adds 12 tests, all passing, and zero new failures.
- Portal frontend: `vite build` succeeds; `tsc --noEmit` and eslint show no new errors in the
  edited page (2 pre-existing lint findings unchanged).
- No hardcoded deployment strings (verified by grep over the diff) — media host handling is
  behaviour-based (R2-validity check), never host- or region-name-based.

## 5. PR

(PR URL added after creation — see PR titled "feat(portal): media rendering audit/fixes + mark-complete for quiz-less modules (BUG-131 Phase 4)")
