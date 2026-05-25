# 📸 Pic-to-LP (Photo → Illustrated Lesson Plan)

> Snap a photo of a textbook page and get back a colourful, ready-to-teach 2-page lesson plan built around it.

## What it is

Instead of typing a topic, the teacher photographs the textbook page they're about to teach. Rumi reads the
page, confirms what the teacher wants, and renders a 2-page **illustrated** lesson-plan PDF — hero artwork,
a big idea, guided practice, and an exit task — all anchored to that exact page. It's the most visual of the
lesson-plan paths.

## How it works

1. **Photo in** — the teacher sends one or more photos of a textbook page. Entry point: [bot/shared/handlers/image-message.handler.js](../../bot/shared/handlers/image-message.handler.js) (`tryPicLpRoute`).
2. **Classify + collect** — incoming images are batched (a short coalesce window groups a burst of photos) and classified; if they're book pages, a session is created in `pic_lp_sessions` and the teacher is asked what they want (lesson plan / homework / …).
3. **Render** — for a lesson plan, the job goes to the worker [bot/workers/pic-lp-kieai.worker.js](../../bot/workers/pic-lp-kieai.worker.js), which builds prompts from the page and renders two illustrated pages with an image model, then assembles them into a PDF with a footer.
4. **Deliver** — the PDF is sent on WhatsApp and recorded in `lesson_plans` (with `source = 'pic_to_lp_kieai'` and the originating `pic_lp_session_id`).

The pic-to-LP services live under [bot/shared/services/pic-to-lp/](../../bot/shared/services/pic-to-lp/)
(session, page collector, classifier, batch coalescer, prompt builder, image-model client).

## What the teacher experiences

Photograph the page → "give me a few minutes" → a polished, illustrated 2-page plan that looks like a
designer made it — far more engaging than a wall of text.

## Enable it

Needs **`KIE_API_KEY`** (the image model that renders the pages) and the region toggle
`region_features.pic_lp_enabled` (on by default). Rendering an illustrated page takes longer than a text
plan, so the teacher gets an upfront wait message.

## Where it fits

Pic-to-LP is the **photo** path of the lesson-plan feature; the text paths (curriculum + generic Gamma) are
described in [LP_PATHS.md](../LP_PATHS.md). It does **not** go through the text LP router.

## Related

- [LP paths](../LP_PATHS.md) — all three lesson-plan paths side by side.
- [video-generation](../../.claude/skills/video-generation/SKILL.md) — the other image/render pipeline (presigned-URL pattern, checkpointing).
