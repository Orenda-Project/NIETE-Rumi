# R2 CORS rule for portal uploads (bd-lfzoz)

**Status: NOT APPLIED.** Needs a Cloudflare admin, and an explicit go — the bucket is shared.

## Why

Teachers upload classroom recordings, lesson plans and photos from the portal
**straight to R2** with a presigned PUT (the bytes never pass through our servers).
A browser only sends that PUT if the bucket's CORS policy allows it.

Measured 2026-10-01 against `digital-coach-audio`: a CORS preflight
(`OPTIONS`, `Access-Control-Request-Method: PUT`, `…-Headers: content-type`)
on a freshly presigned PUT returned **403 with no `Access-Control-Allow-Origin`**
from both `https://portal.niete.edu.pk` and `https://localhost` (the Android app's
WebView origin). So today every portal upload would fail in the browser, while all
server-side tests pass.

## Blast radius

`digital-coach-audio` is **shared** by NIETE and the main bot (PK, TZ, YE) — same
bucket name, same Cloudflare account. The rule below is additive and only says which
web pages may *send* a request; every write still needs a valid presigned signature,
which only the bot mints, per teacher, per key, for 15 minutes. It does not change
any existing object, URL, or server-side read/write.

## The rule

Cloudflare dashboard → R2 → `digital-coach-audio` → Settings → CORS policy → add:

```json
[
  {
    "AllowedOrigins": [
      "https://portal.niete.edu.pk",
      "https://portal-production-6a508.up.railway.app",
      "https://localhost"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Add the staging and sandbox portal hosts before testing there.** They are not
recorded in `niete-environments.md` or the repo; read them off the Railway `portal`
service of each project rather than guessing.

If a CORS policy already exists, **append** this object to it — replacing the
policy would drop whatever rules other surfaces rely on.

## Verify after applying

```bash
# with R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME exported
node scripts/ops/r2-cors-preflight.js                    # the three default origins
node scripts/ops/r2-cors-preflight.js https://<staging-portal-host>
```

It signs a PUT and sends only the browser's preflight (OPTIONS, no body — nothing is
written). Today it prints `REFUSED … HTTP 403` for every origin and exits 1; after the
rule it must print `ALLOWED` and exit 0. Only then is the portal upload usable.
