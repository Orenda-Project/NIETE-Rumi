# assessment-gen-flow.json

Endpoint Flow. Every screen is served by the server, so what she sees is always
valid for the book we actually hold.

```
CLASS → COVERAGE (→ PAGES) → QUESTIONS (→ TYPES) → CONFIRM
```

CONFIRM is terminal: it closes the Flow, and the request is submitted from the
`nfm_reply` completion rather than from a screen. The review/edit screens
(KEEP, PICK, PICK_DONE, EDIT_*) are reached by a separate `:assessment-review:`
token and are gated on `assessment_editing_enabled`.

The endpoint is `/api/flows/assessment-gen`.

## Publishing

```
python3 scripts/publish-assessment-gen-flow.py --flow-id <id>            # draft (validates)
python3 scripts/publish-assessment-gen-flow.py --flow-id <id> --publish  # go live
```

**This file must contain no keys outside Meta's Flow JSON schema.** The
documentation lives here rather than inline because Meta rejects unknown
top-level properties — `_comment` and `_instructions` returned
`INVALID_PROPERTY_KEY` on upload and left the Flow stuck in DRAFT
(2026-09-05, prod Flow 2277158709703257).
