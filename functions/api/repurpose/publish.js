// POST /api/repurpose/publish  { videoId, clipId, platform } -> pushes one
// approved clip live to tiktok or instagram. LinkedIn is explicitly
// rejected — no reliable publish API exists, captions get copy-pasted
// manually. Hard-enforces the approval gate: 409 if the clip isn't
// "approved", so this can't be used to bypass the human review step in
// approve.js.

const { getVideo, updateClip } = require('../../../lib/video-store.js');
const { publishClip: publishToTikTok } = require('../../../lib/tiktok-publish.js');
const { publishClip: publishToInstagram } = require('../../../lib/instagram-publish.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, clipId, platform } = body;

  if (!videoId || !clipId || !platform) {
    return Response.json({ error: 'videoId, clipId, and platform are required' }, { status: 400 });
  }
  if (platform === 'linkedin') {
    return Response.json(
      { error: 'LinkedIn has no reliable publish API — copy the generated caption and post manually' },
      { status: 400 }
    );
  }
  if (platform !== 'tiktok' && platform !== 'instagram') {
    return Response.json({ error: `Unknown platform "${platform}" — expected "tiktok" or "instagram"` }, { status: 400 });
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }
  const clip = video.clips.find(c => c.id === clipId);
  if (!clip) {
    return Response.json({ error: `No clip "${clipId}" on video "${videoId}"` }, { status: 404 });
  }
  if (clip.status !== 'approved') {
    return Response.json(
      { error: `Clip is "${clip.status}", not "approved" — approve it via /api/repurpose/approve first` },
      { status: 409 }
    );
  }

  const clipObject = await env.MEDIA.get(clip.r2Key);
  if (!clipObject) {
    return Response.json({ error: `Clip file not found in R2 at "${clip.r2Key}"` }, { status: 404 });
  }

  let platformPostId;
  if (platform === 'tiktok') {
    if (!env.TIKTOK_ACCESS_TOKEN) {
      return Response.json(
        { error: 'TIKTOK_ACCESS_TOKEN is not configured — set it via `wrangler pages secret put TIKTOK_ACCESS_TOKEN`' },
        { status: 500 }
      );
    }
    const result = await publishToTikTok(
      env.TIKTOK_ACCESS_TOKEN,
      clipObject.body,
      clip.captions.tiktok,
      { sizeBytes: clipObject.size }
    );
    platformPostId = result.publishId;
  } else {
    if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID) {
      return Response.json(
        { error: 'INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID must both be configured — set them via `wrangler pages secret put <NAME>`' },
        { status: 500 }
      );
    }
    if (!env.MEDIA_PUBLIC_BASE_URL) {
      return Response.json(
        { error: 'MEDIA_PUBLIC_BASE_URL is not configured — Instagram needs a public URL to fetch the clip from' },
        { status: 500 }
      );
    }
    const publicClipUrl = `${env.MEDIA_PUBLIC_BASE_URL}/${clip.r2Key}`;
    const result = await publishToInstagram(
      env.INSTAGRAM_ACCESS_TOKEN,
      env.INSTAGRAM_USER_ID,
      publicClipUrl,
      clip.captions.instagram
    );
    platformPostId = result.mediaId;
  }

  const publishedAt = new Date().toISOString();
  const updated = await updateClip(env, videoId, clipId, {
    status: 'published',
    publishedTo: { ...clip.publishedTo, [platform]: { publishedAt, platformPostId } },
  });

  const updatedClip = updated.clips.find(c => c.id === clipId);
  return Response.json({ videoId: updated.id, clipId, platform, status: updatedClip.status, platformPostId });
}
