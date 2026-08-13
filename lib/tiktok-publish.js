/**
 * TikTok Content Posting API — push-upload flow (init, then PUT the video
 * bytes to the returned upload URL), the same init-then-upload shape as
 * YouTube's resumable upload in lib/youtube-publish.js. Streamed from R2
 * the same way — never buffer the whole clip in Worker memory.
 *
 * NOT exercised against the real TikTok API — no access token has been
 * configured yet (see wrangler.toml's TIKTOK_ACCESS_TOKEN comment). This
 * follows TikTok's publicly documented Direct Post video flow but has not
 * been live-tested; verify against their current docs before trusting it
 * in production. privacy_level defaults to the safe/private option —
 * widen it once real API access is confirmed working end to end.
 */

const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

/**
 * @param {string} accessToken
 * @param {ReadableStream} bodyStream — clip video bytes
 * @param {string} caption
 * @param {{sizeBytes: number}} meta
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{publishId: string}>}
 */
async function publishClip(accessToken, bodyStream, caption, meta, fetchFn = fetch) {
  const initRes = await fetchFn(INIT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: { title: caption, privacy_level: 'SELF_ONLY' },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: meta.sizeBytes,
        chunk_size: meta.sizeBytes,
        total_chunk_count: 1,
      },
    }),
  });

  if (!initRes.ok) {
    throw new Error(`TikTok publish init failed: ${initRes.status} ${await initRes.text()}`);
  }

  const initData = await initRes.json();
  const uploadUrl = initData.data && initData.data.upload_url;
  const publishId = initData.data && initData.data.publish_id;
  if (!uploadUrl || !publishId) {
    throw new Error('TikTok publish init response had no upload_url/publish_id');
  }

  const uploadRes = await fetchFn(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'video/mp4',
      'content-range': `bytes 0-${meta.sizeBytes - 1}/${meta.sizeBytes}`,
    },
    body: bodyStream,
  });

  if (!uploadRes.ok) {
    throw new Error(`TikTok clip upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  return { publishId };
}

module.exports = { publishClip };
