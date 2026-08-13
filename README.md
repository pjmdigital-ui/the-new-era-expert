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

**Topics slice** (ranking/demand-scoring):

- **`lib/topic-ranker.js`** — the coverage-gated rotation sort (fewest-times-covered
  first, demand score as tie-break only, staleness as final tie-break). This
  is the exact fix for a real bug on the sibling project: sorting by demand
  first meant the same 3 highest-scoring topics got picked forever, since
  demand scores are essentially never exactly tied, so the recency tie-break
  never fired. Tested — see `lib/topic-ranker.test.js`, including a
  regression test that specifically reproduces that scenario.
- **`lib/topic-agent.js`** — demand scoring against the YouTube Data API.
- **`lib/topics-store.js`** — the single KV read/write path for topic data.
- **`data/seed-topics.json`** — all 42 candidate topics from the filming
  source material.
- **`functions/api/topics/`** — `index.js` (GET, ranked list), `cover.js`
  (POST, mark a topic filmed), `refresh.js` (POST, re-score against real
  YouTube data).
- **`src/index.html` + `src/app.js`** — the dashboard page: ranked topic
  table, "film this next" callout, refresh button, mark-covered per row.

**Video pipeline** (upload → metadata → publish → repurpose):

- **`lib/video-store.js`** — per-video pipeline records (upload state,
  metadata, YouTube publish info, repurposed clips), keyed one KV entry per
  video rather than a single shared blob like topics — videos accumulate
  indefinitely and multiple routes patch different videos concurrently, so
  a shared blob would let those writes clobber each other.
- **`functions/api/upload/{start,part,complete,abort}.js` + `[id]/status.js`**
  — chunked/resumable upload on top of R2's native multipart API.
- **`lib/thumbnail.js`** — the text-safety layer for thumbnail generation
  (SVG `textLength` hard constraint so on-image text can't overflow the
  frame regardless of font substitution). `buildThumbnailTextElement` is
  now used directly by the thumbnail route to composite text over an AI
  background in one pass.
- **`lib/thumbnail-image.js`** — AI background image generation (always a
  no-text prompt). Wraps OpenAI's Images API as a concrete default —
  **`IMAGE_GEN_API_KEY` has no vendor precedent elsewhere in this repo, so
  treat this as a placeholder pending confirmation of the intended
  provider.**
- **`lib/thumbnail-render.js`** — wraps `@resvg/resvg-wasm` (this repo's
  first runtime dependency) to rasterize the composite SVG to PNG
  in-Worker. **Not smoke-tested against Pages Functions' actual bundler
  yet** — verify the wasm import and bundle size with `wrangler pages dev`
  before deploying.
- **`lib/youtube-copy-rules.js`** — title/thumbnail/description validation
  rules, run as a validation pass on AI-generated copy.
- **`lib/metadata-agent.js`** — AI title/description/thumbnail-text
  generation via Claude's Messages API (structured JSON output), with a
  validate-and-retry loop (max 3 attempts, never hard-fails) against
  `youtube-copy-rules.js`.
- **`functions/api/metadata/{generate,thumbnail,select}.js`** — generate
  AI options, render+store a thumbnail candidate, then lock in a final
  selection (hard validation gate before publish).
- **`lib/youtube-oauth.js`** + **`lib/youtube-publish.js`** — the OAuth
  refresh-token exchange and YouTube's 3-step resumable upload protocol +
  `thumbnails.set`, with the R2 object streamed directly into the upload
  PUT (never buffered — an 8-15 minute video would risk the Workers
  ~128MB memory ceiling).
- **`functions/api/publish-youtube.js`** — chains OAuth → resumable
  upload → thumbnail set → video record update. Defaults to
  `privacyStatus: "private"`.
- **`lib/media-transform.js`** — audio extraction and clip cut + vertical
  crop via Cloudflare's Media Transformations Workers binding, entirely
  inside Cloudflare (no third-party video vendor). Clip durations are
  hard-clamped to Media Transformations' 1-60s range.
- **`lib/clip-selector.js`** — since this is real talking-head footage
  (not the sibling project's AI-rendered slides+voiceover), clip-worthy
  moments come from a timestamped transcript via Claude, not pre-known
  scene markers.
- **`lib/caption-writer.js`** — validates AI-generated platform captions
  against `youtube-copy-rules.js`'s `validateHookCopy`.
- **`lib/tiktok-publish.js`** + **`lib/instagram-publish.js`** — push-upload
  (TikTok) and pull-based container publish (Instagram — needs a public
  clip URL, see `MEDIA_PUBLIC_BASE_URL` below) to each platform.
- **`functions/api/repurpose/{generate,approve,publish}.js`** — generate
  clips (transcript → AI segment selection → cut+crop → stage as
  "staged"), approve/reject (the human gate), and publish one approved
  clip to `tiktok` or `instagram`. `linkedin` is explicitly rejected (no
  reliable publish API — captions get copied manually) and `publish.js`
  409s on any clip that isn't `"approved"`, so the approval gate can't be
  bypassed by calling it directly.

**Dashboard UI** (the visual layer over everything above — plain HTML/CSS/JS,
no framework, matching the topics dashboard's existing style):

- **`functions/api/videos/index.js`** (GET, list summaries) and
  **`functions/api/videos/[id].js`** (GET, full record) — thin wrappers over
  `listVideos`/`getVideo` in `video-store.js`. Nothing previously exposed
  these, so the dashboard had no way to list or read videos before this.
- **`functions/api/media/[[path]].js`** — streams thumbnails/clips/source
  video straight out of the private `MEDIA` R2 bucket for `<img>`/`<video>`
  tags (only serves the `thumbnails/`, `clips/`, `videos/` prefixes; 403s on
  anything else). Avoids needing R2's public-access setup just to preview
  media in the dashboard — see the `MEDIA_PUBLIC_BASE_URL` note below for
  why Instagram still needs that setup regardless.
- **`src/styles.css`** — the topics dashboard's inline styles, extracted so
  both pages share one theme; `src/index.html` now links it and has a
  Topics/Videos nav.
- **`src/videos.html` + `src/videos.js`** — one page, list view (all videos,
  upload-new-video form with chunked-upload progress) and detail view
  (`?id=`) with four sections mirroring the pipeline: upload status,
  metadata (generate options → pick title/description/thumbnail image →
  lock in), publish to YouTube, and repurpose (generate clips → approve/
  reject → publish per clip to tiktok/instagram, with copy-to-clipboard
  captions for linkedin's manual flow). Re-fetches the full video record
  after every mutating action rather than hand-merging each route's partial
  response shape.

**All lib/ logic has been run, not just written** — `node --test lib/*.test.js`
passes 85/85 (64 from the video-pipeline backend — upload, metadata,
publish-youtube, repurpose — plus 21 from the pre-existing topics slice:
`topic-agent.test.js`, `topic-ranker.test.js`, `youtube-copy-rules.test.js`),
with every external API call (Claude, OpenAI image gen, YouTube, TikTok,
Instagram) tested against an injectable mock `fetch`. **The upload +
videos-list/detail + media-proxy routes have now also been smoke-tested
end-to-end against a real `wrangler pages dev` server** (a real multipart
file upload through completion, list/detail rendering, and the dashboard UI
itself driven headlessly with Playwright — every section, selection state,
and gating rule behaves as designed). What's still **not** verified: an
actual call to any external API (Claude, OpenAI, YouTube, TikTok, Instagram,
Workers AI Whisper — none have real credentials configured), or
`lib/thumbnail-render.js` / `lib/media-transform.js` against Cloudflare's
real WASM/Media Transformations bindings.

**Local-dev gotcha found while smoke-testing:** `wrangler pages dev` treats
the `[ai]` and `[media]` bindings as **remote-only** — even without
`--remote`, it tries to open a remote proxy session for them at startup and
hard-crashes the *entire* dev server if `CLOUDFLARE_API_TOKEN` isn't set,
even for requests to routes that never touch AI or Media Transformations.
There's no known local simulation for either binding. Until a real
Cloudflare API token is available for local dev, test AI/media-dependent
routes by temporarily commenting out the `[ai]`/`[media]` blocks in a
**local, uncommitted** copy of `wrangler.toml` (everything else runs fine
without them) — do not commit `wrangler.toml` with those blocks removed.

## Known open pieces — not yet built or not yet verified

- **`wrangler pages dev` smoke test for the AI-dependent routes.** Upload,
  the videos list/detail routes, and the media proxy are now verified
  end-to-end (see above). Metadata generation, publish-youtube, and
  repurpose still can't be exercised locally without real secrets — and
  even with secrets, `[ai]`/`[media]` need a `CLOUDFLARE_API_TOKEN` for
  local dev per the gotcha noted above.
- **Image-gen vendor confirmation.** `lib/thumbnail-image.js` wraps OpenAI's
  Images API as a placeholder — confirm whether that's the intended
  provider for `IMAGE_GEN_API_KEY` before relying on it.
- **Workers AI Whisper model id.** `functions/api/repurpose/generate.js`
  references `@cf/openai/whisper` — verify this is the correct current
  model id, and that it returns segment/word timestamps (not just plain
  text), against Cloudflare's Workers AI model catalog.
- **`[media]` binding shape / wrangler version.** `wrangler.toml`'s
  `MEDIA_TRANSFORM` binding follows Cloudflare's documented Media
  Transformations API but hasn't been confirmed against this repo's
  pinned `wrangler ^4.0.0`.
- **R2 public access for Instagram.** Instagram's Reels publish is a pull
  model — it fetches the clip from a URL rather than accepting a
  push-upload. `MEDIA_PUBLIC_BASE_URL` needs the `MEDIA` R2 bucket's
  public access (r2.dev subdomain or a custom domain) enabled in the
  Cloudflare dashboard before it resolves to anything real.
- **`repurpose/generate.js`'s wall-clock duration is unverified.** It
  chains audio extraction → transcription → Claude → N clip cuts inside
  one synchronous request. Prototype against a real 10-minute video before
  trusting the synchronous design — a queued/async job (Cloudflare
  Queues or Durable Objects) may be needed instead.
- **TikTok/Instagram/YouTube publish flows have never made a real call.**
  All three are built and unit-tested against mocked responses only — no
  access tokens are configured yet.
- **Actual Cloudflare resources.** `wrangler.toml` has placeholder KV
  namespace ID, R2 bucket name, and public R2 base URL — need to be
  created for real in the Cloudflare dashboard before first deploy.
- **No API keys/secrets are set anywhere yet** — `CLAUDE_API_KEY`,
  `IMAGE_GEN_API_KEY`, `YOUTUBE_DATA_API_KEY`,
  `YOUTUBE_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN`, `TIKTOK_ACCESS_TOKEN`,
  `INSTAGRAM_ACCESS_TOKEN`/`_USER_ID` all need to be created and set via
  `wrangler pages secret put` before any of the AI/publish endpoints can
  work against real services.
- **Platform auto-publish decisions.** TikTok and Instagram both have real
  content-posting APIs, now wired (see above). LinkedIn's organic video
  API access is restrictive — plan on a manual copy-paste fallback
  (captions ready in the dashboard, creator posts manually) unless a
  LinkedIn API partnership exists.
- **Upload resume-after-reload isn't supported.** The dashboard's upload
  flow handles same-session chunk retries (idempotent by `partNumber`), but
  browsers can't reattach a `File` handle after a page reload — an
  interrupted upload has to be aborted and restarted with the file
  re-selected, not resumed. `/api/upload/<id>/status` exists for a future
  resume UI if that becomes worth building.

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
npm run topics:test    # runs lib/topic-ranker.test.js only
node --test lib/*.test.js   # runs the full test suite (85 tests)
npm run dev             # local Cloudflare Pages dev server
npm run deploy           # wrangler pages deploy
```

Before first deploy:
1. Create the real KV namespace and R2 bucket in Cloudflare, update the IDs
   in `wrangler.toml`.
2. Enable public access on the `MEDIA` R2 bucket and set
   `MEDIA_PUBLIC_BASE_URL` to the resulting URL (required for Instagram's
   publish flow).
3. Set every secret listed at the bottom of `wrangler.toml` via
   `wrangler pages secret put <NAME>`.
4. Confirm the `[media]` (Media Transformations) binding is supported by
   the pinned `wrangler` version — bump if needed.
5. Run `wrangler pages dev` and smoke-test each endpoint group before
   trusting it against real user data.
