// POST /api/repurpose/generate  { videoId } -> extracts audio, transcribes
// via Workers AI Whisper, has Claude pick 3-5 self-contained clip moments +
// platform captions, cuts+crops each via Media Transformations, and stages
// them in the video record as "staged" (awaiting human approval per the
// README's approval-queue requirement).

const { getVideo, addClips } = require('../../../lib/video-store.js');
const { extractAudio, cutAndCropClip } = require('../../../lib/media-transform.js');
const { selectClipCandidates } = require('../../../lib/clip-selector.js');
const { validateCaptions } = require('../../../lib/caption-writer.js');

// Verify the exact Workers AI Whisper model id at implementation time — it
// needs to return segment/word timestamps, not just plain text.
// formatTranscript() below degrades gracefully to plain text if it doesn't.
const WHISPER_MODEL = '@cf/openai/whisper';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId } = body;

  if (!videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }
  if (!env.CLAUDE_API_KEY) {
    return Response.json(
      { error: 'CLAUDE_API_KEY is not configured — set it via `wrangler pages secret put CLAUDE_API_KEY`' },
      { status: 500 }
    );
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }
  if (video.status === 'uploading') {
    return Response.json(
      { error: `Video is still "${video.status}" — wait for the upload to complete first` },
      { status: 409 }
    );
  }

  const audioBytes = await extractAudio(env, video.r2Key);
  const transcription = await env.AI.run(WHISPER_MODEL, { audio: Array.from(audioBytes) });
  const transcript = formatTranscript(transcription);

  const candidates = await selectClipCandidates(transcript, env.CLAUDE_API_KEY, { count: 4 });

  const results = await Promise.allSettled(
    candidates.map(async candidate => {
      const clipBytes = await cutAndCropClip(env, video.r2Key, {
        startSeconds: candidate.startSeconds,
        durationSeconds: candidate.durationSeconds,
      });

      const captionValidation = validateCaptions(candidate.captions);
      const clipId = crypto.randomUUID();
      const r2Key = `clips/${videoId}/${clipId}.mp4`;
      await env.MEDIA.put(r2Key, clipBytes, { httpMetadata: { contentType: 'video/mp4' } });

      return {
        id: clipId,
        startSeconds: candidate.startSeconds,
        durationSeconds: candidate.durationSeconds,
        transcriptExcerpt: candidate.transcriptExcerpt,
        captions: candidate.captions,
        captionWarnings: captionValidation.issues,
        r2Key,
        status: 'staged',
        publishedTo: { tiktok: null, instagram: null },
      };
    })
  );

  const clips = [];
  const errors = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      clips.push(result.value);
    } else {
      errors.push(result.reason?.message || String(result.reason));
    }
  }

  if (clips.length === 0) {
    return Response.json(
      { error: 'Media Transformations failed to produce any clips', errors },
      { status: 500 }
    );
  }

  const updated = await addClips(env, videoId, clips);

  return Response.json({
    videoId: updated.id,
    clipsGenerated: clips.length,
    clips: clips.map(({ captionWarnings, ...rest }) => rest),
    errors: errors.length > 0 ? errors : undefined,
  });
}

function formatTranscript(transcription) {
  if (transcription.segments && Array.isArray(transcription.segments)) {
    return transcription.segments
      .map(seg => `[${formatSeconds(seg.start)}] ${seg.text}`)
      .join('\n');
  }
  if (transcription.words && Array.isArray(transcription.words)) {
    return transcription.words.map(w => `[${formatSeconds(w.start)}] ${w.word}`).join(' ');
  }
  return transcription.text || '';
}

function formatSeconds(seconds) {
  const s = Math.floor(seconds || 0);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
