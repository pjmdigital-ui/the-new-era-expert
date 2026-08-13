# The New Era Expert — Content Dashboard

A lightweight dashboard that takes manually-shot videos and automates
everything around them: AI-generated titles/thumbnails/descriptions,
one-click YouTube publishing, and automatic repurposing into short-form
clips for TikTok, Instagram, and LinkedIn.

Scaled-down sibling of a more complex system (Influence Academy's agentic
marketing dashboard, `ia-agentic-marketing-team`). That system's auto-render
pipeline (AI writes the script, AI voices it, AI renders the full video) is
explicitly out of scope here — this business shoots its own video.
Everything downstream of "I have a finished video file" is what this builds.

**Full strategic context lives in the `kbt-ai` repo:**
- `01-Platform-Docs/New-Era-Expert-Context.md` — how this brand connects to Tool Hub AI
- `strategy-notes/2026-08-education-content-plan-belief-ladder.md` — the argument, audience, and content methodology
- `strategy-notes/2026-08-filming-source-material.md` — the condensed topic/evidence reference for scripting

---

## Business context

- **Business name:** The New Era Expert
- **Niche / topic area:** Teaching established and aspiring experts (coaches, consultants, course creators, authors, community owners) how to transition from info-products into AI-powered "knowledge-based tool hubs," feeding into MyToolHub as the platform
- **Target audience:** Primary — established experts with an existing audience and IP, under AI pressure. Secondary — aspiring experts with undocumented expertise ("skip the course, start with the hub")
- **Existing YouTube channel:** New — built from zero
- **Brand voice / tone:** Belief-shift and authority-based, not hustle-framing. Every video needs to name both the category (knowledge-based tool hub) and MyToolHub as "the fastest and easiest way to build one" by the end
- **Brand assets:** Logo locked — see `01-Platform-Docs/new-era-expert-logo.png` in `kbt-ai` (gold, thin-ring mark, black background)
- **Publishing cadence goal:** 2 long-form videos/week, batch-recorded
- **Target video length:** 8-15 minutes

---

## Scope

**In scope:**
- Manual video upload (chunked/resumable)
- AI-generated title + thumbnail + description options per video, editable/regenerable before publishing
- One-click "Publish to YouTube"
- Automatic short-form repurposing — 3-5 vertical clips per long-form video, platform-specific captions, publish or stage for TikTok / Instagram Reels / LinkedIn
- A simple approval queue (Awaiting Approval → Published) — nothing goes live without a human glance
- Topic/idea generation, seeded from the existing content framework (see "Topic seed" below), ranked against real demand data

**Explicitly out of scope:**
- AI script writing, AI voice generation, AI full-video rendering
- Complex scheduling calendars, multi-week content batching
- Community/comment-reply automation (unless later requested)

---

## Topic seed — answering "where does the topic list come from"

There's an existing framework to seed from, not a blank page: the content
plan's 6-angle belief structure (problem-is-real → alternatives-fail →
category-exists → credible → capable → urgent) plus a candidate topic list
already compiled by entry point in `strategy-notes/2026-08-filming-source-material.md`
in `kbt-ai`.

**Important:** those candidate topics are hypotheses based on existing market
understanding, not validated search/consumption data — that research was
flagged as not-yet-done. This dashboard's demand-ranking system (see
`lib/topic-ranker.js`) is what should actually close that gap, by scoring
the seed list (and any new topics discovered) against real competitor-channel
data rather than assumption.

---

## What's built so far

- **`lib/topic-ranker.js`** — the coverage-gated rotation sort (fewest-times-covered
  first, demand score as tie-break only, staleness as final tie-break). This
  is the exact fix for a real bug on the sibling project: sorting by demand
  first meant the same 3 highest-scoring topics got picked forever, since
  demand scores are essentially never exactly tied, so the recency tie-break
  never fired. Tested — see `lib/topic-ranker.test.js`, including a
  regression test that specifically reproduces that scenario.
- **`lib/youtube-copy-rules.js`** — codifies the title/thumbnail/description
  rules (banned filler words, length windows, no filter-hook openers, no
  stated video length) as runnable validators, not just prose an AI
  generation call could drift from. Tested.
- **`lib/thumbnail.js`** — the text-safety layer for thumbnail generation:
  AI generates the background image only (no-text prompt), real text gets
  drawn in code via SVG with a hard `textLength` constraint so it can't
  overflow the frame even if the rendering environment substitutes a
  different font than requested. Tested.
- **`lib/topic-agent.js`** — demand scoring: searches the YouTube Data API
  for videos matching a topic, scores by view count (log-scaled so one
  viral outlier can't dominate) + recency + match count. The scoring math
  is a pure function tested with mocked data; the live API calls are
  tested against an injectable mock fetch, since there's no real API key
  configured yet. Needs `YOUTUBE_DATA_API_KEY` (a simple read-only Google
  Cloud Console key — not the OAuth credential the publish flow needs).
- **`lib/topics-store.js`** — the single KV read/write path every route
  goes through, so the topic list can never fork into two different copies.
- **`data/seed-topics.json`** — all 42 candidate topics from
  `strategy-notes/2026-08-filming-source-material.md`, structured to match
  what `topic-ranker.js` expects, `demandScore: 0` until a refresh runs.
- **`functions/api/topics/`** — the three routes the dashboard actually
  calls: `index.js` (GET, ranked list), `cover.js` (POST, mark a topic
  filmed), `refresh.js` (POST, re-score a batch against real YouTube
  data). Split into separate files because Cloudflare Pages Functions
  routes by file path — a single `topics.js` handling `/api/topics/cover`
  as a sub-path returned 405 in local testing; this file layout is the
  actual fix, not a workaround.
- **`src/index.html` + `src/app.js`** — the dashboard page itself: ranked
  topic table, "film this next" callout, a refresh button, mark-covered
  per row.

**All of the above has been run, not just written.** `node --test
lib/*.test.js` passes 25/25. Beyond unit tests, `wrangler pages dev` was
booted locally and hit with real HTTP requests against the compiled
Worker + Functions + local-simulated KV: the dashboard page loads, GET
`/api/topics` returns the seeded, ranked list, and POST `/api/topics/cover`
correctly demotes a topic and advances `nextUp` — verified end to end, not
assumed from reading the code.

## Known open pieces — not yet built

- **SVG-to-raster rendering.** `thumbnail.js` builds the SVG markup for the
  text layer but doesn't rasterize it — Cloudflare Workers doesn't support
  native canvas/sharp bindings. Needs a WASM-based SVG renderer (e.g.
  resvg-wasm) or an external rendering service, picked and wired in once
  the upload/generate-metadata endpoint gets built.
- **Upload, generate-metadata, publish-youtube, repurpose endpoints** — not started. Topics is the only functional slice of the API so far.
- **Actual Cloudflare resources.** `wrangler.toml` has placeholder KV
  namespace ID and R2 bucket name — need to be created for real in the
  Cloudflare dashboard before first deploy. Local testing so far has only
  used wrangler's local-simulated KV, not a real namespace.
- **YOUTUBE_DATA_API_KEY isn't set anywhere yet** — the refresh endpoint
  is built and tested against mocked responses, but has never made a real
  call to the actual YouTube API. Get a key from Google Cloud Console
  (Enable "YouTube Data API v3" → Credentials → API Key) and set it via
  `wrangler pages secret put YOUTUBE_DATA_API_KEY` before trusting real
  demand scores.
- **Platform auto-publish decisions.** TikTok and Instagram both have real
  content-posting APIs. LinkedIn's organic video API access is restrictive —
  plan on a manual copy-paste fallback (captions ready in the dashboard,
  creator posts manually) unless a LinkedIn API partnership exists.

## Engineering pitfalls to design around (carried over from the sibling project)

1. **Cloudflare Pages doesn't necessarily auto-deploy on git push** — verify the GitHub integration is actually wired, with a real test push, don't assume.
2. **Workers and Pages Functions are separate deploy targets** — a fix in one doesn't affect the other.
3. **One source of truth for demand/topic data** — the "what's coming up next" preview and the actual automated picker must both read the same underlying data (same KV keys), never two independent copies. This caused real confusion on the sibling project.
4. **API keys are shown once, never again** — save a copy somewhere retrievable the moment a key is created.
5. **Grammar-concatenation bugs** — if a stored display name might already contain an article ("The Voice Guide"), check any template sentence that adds its own article before it.
6. **Stale-data self-cleanup** — approval queues and scheduled-item views should automatically exclude old/stuck items from the primary view from day one.

## Setup

```bash
npm install
npm run topics:test   # runs lib/topic-ranker.test.js
node --test lib/*.test.js   # runs the full test suite
npm run dev            # local Cloudflare Pages dev server
npm run deploy          # wrangler pages deploy
```

Before first deploy: create the real KV namespace and R2 bucket in
Cloudflare, update the IDs in `wrangler.toml`, and set the secrets listed
at the bottom of that file via `wrangler pages secret put`.
