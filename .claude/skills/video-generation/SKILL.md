---
name: video-generation
description: The educational-video pipeline — script → TTS → image → animation → assembly → delivery — its env vars, the presigned-URL gotcha, the checkpoint/resume system, and common failures.
---

# Video Generation Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [debugging](../debugging/SKILL.md), [digital-coach](../digital-coach/SKILL.md)

The bot can generate a short narrated educational video from a topic. It's the heaviest async pipeline —
script, voice, images, animation, and final assembly — so it runs entirely on the queue worker with a
checkpoint system so a crash mid-way can resume.

## Pipeline

```
/video or a topic
  → VideoOrchestrator (language prompt → selection)
  → creates a video_requests row → enqueues a video_generation job
  → the queue worker (bot/workers/video-generation.worker.js):
      script (LLM) → TTS audio → images → (send a PDF) → animation → assembly (FFmpeg)
  → deliver the video to the user
```

## Key files

| Component | File |
|-----------|------|
| Orchestrator | [bot/shared/services/video/video-orchestrator.service.js](../../../bot/shared/services/video/video-orchestrator.service.js) |
| Script | [bot/shared/services/video/video-script.service.js](../../../bot/shared/services/video/video-script.service.js) |
| Image | [bot/shared/services/video/video-image.service.js](../../../bot/shared/services/video/video-image.service.js) |
| Animation | [bot/shared/services/video/video-animation.service.js](../../../bot/shared/services/video/video-animation.service.js) |
| Assembly | [bot/shared/services/video/video-assembly.service.js](../../../bot/shared/services/video/video-assembly.service.js) |
| Watermark | [bot/shared/services/video/video-watermark.service.js](../../../bot/shared/services/video/video-watermark.service.js) |
| Worker | [bot/workers/video-generation.worker.js](../../../bot/workers/video-generation.worker.js) |
| Object storage | [bot/shared/storage/r2.js](../../../bot/shared/storage/r2.js) |

> TTS is invoked from the orchestrator/script services (there is no standalone `video-tts` service). The
> language-id branch that routes the user's pick lives in [bot/whatsapp-bot.js](../../../bot/whatsapp-bot.js).

## The presigned-URL gotcha (most common failure)

The image/animation provider must **fetch your images over HTTP**, but the object-storage bucket is
private. Don't make the bucket public — generate **presigned URLs** (`getPresignedUrl()` in `r2.js`, which
uses `@aws-sdk/s3-request-presigner`), valid ~1 hour. Symptom when this is wrong: *"Task failed: Your media
file is unavailable"* at the animation step. If it still fails, confirm `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` are set and the logs show "Generated presigned URL for…".

## Environment variables

| Variable | Purpose |
|----------|---------|
| `KIE_API_KEY` | Image + video-animation provider |
| `R2_ENDPOINT` / `R2_BUCKET_NAME` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Object storage + presigned URLs |
| `ELEVENLABS_API_KEY` | TTS (English) |
| `UPLIFT_API_KEY` | TTS (other languages) |
| `VIDEO_GENERATION_ENABLED` | Feature flag |
| `VIDEO_DAILY_LIMIT` | Per-user rate limit |

No public-URL var is needed — presigned URLs cover provider access.

## Checkpoint / resume

The pipeline survives crashes by checkpointing progress on the `video_requests` row (completed image URLs,
completed segment URLs) and `video_tasks` (provider task ids). On restart the worker skips finished
images/videos and resumes from the last incomplete task.

```sql
SELECT id, topic, language, status, error_message, created_at
FROM video_requests WHERE user_id = '<uuid>' ORDER BY created_at DESC;

SELECT video_request_id, filename, task_id, status, result_url
FROM video_tasks WHERE video_request_id = '<id>' ORDER BY created_at;
```

## Common failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| "media file is unavailable" (animation) | Provider can't fetch a private URL | Use presigned URLs (above) |
| Language selection does nothing | Missing language-id branch in whatsapp-bot.js | Add the handler for the video language ids |
| Job lost / reprocessed | Queue visibility timeout too short for a long render | Raise the visibility timeout |
| TTS fails for non-English | Provider doesn't support the language | Route non-English to the alternate TTS provider |
| FFmpeg crashes on the host | No FFmpeg binary in the container | Use the bundled `@ffmpeg-installer/ffmpeg` packages |

To investigate a specific failure, trace the request's correlation id through the logs — see
[debugging](../debugging/SKILL.md).

## Related Skills

- [debugging](../debugging/SKILL.md) — trace a failed render end to end.
- [digital-coach](../digital-coach/SKILL.md) — where video sits in the overall architecture.
