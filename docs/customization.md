# Customization Guide

## Branding

Override bot identity via environment variables or by editing `bot/shared/config/branding.js`:

```env
BOT_NAME=MyAssistant
ORG_NAME=My School District
SUPPORT_CONTACT=help@myschool.org
```

Supported languages can be configured in `branding.js`:

```javascript
const supportedLanguages = [
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'ur', name: 'Urdu', direction: 'rtl' },
  // Add your language here
];
```

## Feature Availability (presence-based)

There is **no tier system**. A feature turns on when the env key(s) it needs are present — set them and it
works, leave them blank and it stays off cleanly. The single source of truth is the `FEATURES` map in
`bot/shared/config/feature-availability.js` (each feature → the env key that switches it on). Run
`npm run doctor` to see which features are live for your current `.env`.

Check availability in code:

```javascript
const { isFeatureAvailable } = require('./config/feature-availability');
if (isFeatureAvailable('Voice notes (speech-to-text, Soniox)')) {
  // ... transcription path
}
```

## LLM Provider

Default: OpenRouter (access to 500+ models with one key).

Switch to direct OpenAI:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
```

Change default model:

```env
LLM_MODEL=anthropic/claude-sonnet-4
```

## Adding New Features

1. Add capability to `bot/shared/config/capabilities.config.js`
2. If the feature needs its own API key, add it to the `FEATURES` map in `bot/shared/config/feature-availability.js`
3. Gate with `isFeatureAvailable(...)` in handlers (or just let a missing key degrade gracefully)
4. Add job type to `bot/workers/sqs-worker.js` if async

## File Zones

When pulling upstream updates, files fall into two zones:

### Safe to Customize

These files are yours. Upstream updates rarely touch them, so merge conflicts are unlikely:

| File | Purpose |
|------|---------|
| `.env` | Your credentials and config — **this is where you switch features on** (presence of keys) |
| `bot/shared/config/branding.js` | Bot name, org name, languages |
| `bot/shared/config/feature-availability.js` | The feature → env-key map (rarely edited) |
| `bot/shared/config/capabilities.config.js` | Feature capabilities |
| `bot/shared/config/system-messages.js` | Custom system prompts |
| `bot/shared/services/llm-client.js` | LLM provider config |
| `bot/workers/sqs-worker.js` | Queue worker customization |

### Don't Touch (Upstream-Owned)

Bug fixes and features flow from upstream into these. Editing them will cause merge conflicts:

| Directory | Purpose |
|-----------|---------|
| `bot/shared/handlers/` | Message handlers (text, voice, image, flow) |
| `bot/shared/services/` | Service modules (coaching, reading, video) |
| `bot/shared/database/` | Database query layer |
| `bot/workers/` (core workers) | Background job processors |
| `infrastructure/supabase/` | Schema, RLS policies, migrations |

If you need to change upstream-owned code, open a GitHub issue or PR instead.
