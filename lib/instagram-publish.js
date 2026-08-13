/**
 * Instagram Graph API — Reels publish. Unlike YouTube/TikTok's push-upload,
 * this is a **pull** flow: create a media container pointing at a publicly
 * fetchable clip URL, poll until Instagram finishes fetching/processing it,
 * then publish the container. The public URL requirement is why the R2
 * MEDIA bucket needs public access enabled and a MEDIA_PUBLIC_BASE_URL var
 * (see functions/api/repurpose/publish.js and wrangler.toml) — R2 objects
 * are private by default and Instagram's servers can't reach a private one.
 *
 * NOT exercised against the real Instagram API — no access token/business
 * account has been configured yet (see wrangler.toml's INSTAGRAM_ACCESS_TOKEN
 * and INSTAGRAM_USER_ID comments). Verify against Meta's current Graph API
 * docs before trusting this in production.
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 30;

/**
 * @param {string} accessToken
 * @param {string} igUserId — the Instagram professional/business account id
 * @param {string} publicClipUrl — publicly fetchable URL to the clip video
 * @param {string} caption
 * @param {typeof fetch} [fetchFn]
 * @param {{pollIntervalMs?: number, maxPollAttempts?: number}} [pollOpts]
 * @returns {Promise<{mediaId: string}>}
 */
async function publishClip(accessToken, igUserId, publicClipUrl, caption, fetchFn = fetch, pollOpts = {}) {
  const createRes = await fetchFn(`${GRAPH_API_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: publicClipUrl,
      caption,
      access_token: accessToken,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Instagram media container creation failed: ${createRes.status} ${await createRes.text()}`);
  }
  const createData = await createRes.json();
  const creationId = createData.id;
  if (!creationId) {
    throw new Error('Instagram media container response had no id');
  }

  await waitForContainerReady(accessToken, creationId, fetchFn, pollOpts);

  const publishRes = await fetchFn(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });

  if (!publishRes.ok) {
    throw new Error(`Instagram media publish failed: ${publishRes.status} ${await publishRes.text()}`);
  }
  const publishData = await publishRes.json();
  if (!publishData.id) {
    throw new Error('Instagram media publish response had no id');
  }

  return { mediaId: publishData.id };
}

/**
 * @param {string} accessToken
 * @param {string} creationId
 * @param {typeof fetch} fetchFn
 * @param {{pollIntervalMs?: number, maxPollAttempts?: number}} [opts]
 */
async function waitForContainerReady(accessToken, creationId, fetchFn, opts = {}) {
  const { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS } = opts;

  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    const res = await fetchFn(
      `${GRAPH_API_BASE}/${creationId}?fields=status_code&access_token=${accessToken}`
    );
    if (!res.ok) {
      throw new Error(`Instagram container status check failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error('Instagram failed to process the media container');
    }
    if (attempt < maxPollAttempts - 1) {
      await sleep(pollIntervalMs);
    }
  }
  throw new Error(`Instagram media container did not finish processing after ${maxPollAttempts} polls`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { publishClip, waitForContainerReady };
