# 03 — Digital Coach + Human-in-the-Loop Review

**Status**: 🟡 Draft
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md) D-001, D-003
**Feeds**: [04-data-migration](./04-data-migration.md) (only if we're migrating historic coaching sessions)

---

## Scope

The AI coaching pipeline in `bot/shared/services/coaching/*` (transcript → framework analysis → report → optional reflective chat) **stays as-is**. FICO framework support is already wired.

**New work**: insert a coach review step between AI report generation and teacher delivery. A human coach can approve as-is, edit, or annotate before the teacher sees the report.

## Not doing

- Rewriting the AI pipeline or the FICO transformer
- Porting Taleemabad's `coaching` app (that's a *human coach visit* CoT observation system — a different product; teachers there don't record their class, coaches observe live and fill forms)
- Porting Taleemabad's DC chatbot microservice (at `digitalcoach.taleemabad.com`) — Rumi's own coaching pipeline is more sophisticated

## What we build

### Schema change to existing `coaching_sessions`

Add a review state machine:

```sql
ALTER TABLE coaching_sessions
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_state IN (
    'not_required',           -- region has no coach — deliver direct (current behaviour)
    'pending_ai',             -- AI pipeline running
    'ai_ready',               -- AI done, waiting for coach review
    'pending_coach_review',   -- coach has opened it
    'coach_approved',         -- ready to deliver
    'delivered'               -- teacher has received
  ));

ALTER TABLE coaching_sessions
  ADD COLUMN assigned_coach_id UUID REFERENCES users(id);

CREATE INDEX idx_sessions_review_queue
  ON coaching_sessions (region, review_state, created_at)
  WHERE review_state IN ('ai_ready', 'pending_coach_review');
```

### New table for review actions

```sql
CREATE TABLE coaching_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES coaching_sessions(id) ON DELETE CASCADE,
  reviewer_id       UUID NOT NULL REFERENCES users(id),
  decision          TEXT NOT NULL,   -- 'approve_as_is' | 'approve_with_edits' | 'reject'
  edited_content    JSONB,            -- coach's edited report (structure mirrors ai_report)
  feedback_notes    TEXT,             -- private notes not shown to teacher
  reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Feature flag / region config

```
COACHING_REQUIRES_COACH_REVIEW=true    -- region-scoped, defaults to false
```

When `false`, `review_state` stays `not_required` and delivery is direct — the current behaviour is preserved. When `true`, the pipeline blocks at `ai_ready` until a coach approves.

### Bot changes

`bot/shared/services/coaching/delivery.service.js` (or wherever delivery is dispatched — check the code) gets one branch:

```js
if (region.requiresCoachReview && !session.reviewApproved) {
  await markSessionAsReadyForReview(session);   // sets review_state = 'ai_ready'
  return;   // do NOT send to teacher yet
}
// existing delivery path
```

A separate worker (or webhook from portal) reads `coaching_reviews` inserts with `decision = approve_*` and resumes delivery.

### Portal pages (new)

| Route | Purpose |
|---|---|
| `/coach/queue` | Coach's inbox: sessions where `review_state IN ('ai_ready', 'pending_coach_review') AND assigned_coach_id = me` |
| `/coach/session/:id` | Side-by-side: AI report on left, editor on right; approve / edit / reject buttons |
| `/coach/history` | Sessions I've already reviewed, with search |
| `/admin/coaching-assignments` | Assign coaches to teachers (or geographic regions) |

Reuses the existing portal design system — no new component library.

### Assignment logic

Simplest starting point: **one coach per school**, static assignment stored on the `users` table (add `assigned_coach_id`) or on a new `school_coaches` table. Auto-assign a new session's `assigned_coach_id` from the teacher's school lookup.

Advanced (later): load-balance across multiple coaches, or unassigned pool + coaches self-claim from the queue.

## Interaction with existing FICO pipeline

The AI report structure is unchanged. The coach edits **the same JSON shape** the AI produced, so downstream renderers (PDF, WhatsApp text) don't need to distinguish coach-edited vs. AI-original. Provenance is via `coaching_reviews.edited_content`.

## Open items

- Do we migrate historic Taleemabad coaching data, or start fresh in the new region? (If yes → [04](./04-data-migration.md).)
- What's the teacher-visible signal that this report was coach-reviewed? Add a line like *"Reviewed by [Coach Name]"* to the delivered message?
- If a coach doesn't review within N days, does the AI report auto-release? (SLA fallback.)
- Portal auth model — coaches log in with what? Reuse Rumi's existing portal auth or add coach-specific accounts.
