// GET /api/media/<key> -> streams an object straight out of the MEDIA R2
// bucket (thumbnails, repurposed clips, source videos, presenter photos)
// for the dashboard's <img>/<video> tags. R2 objects are private by
// default and this repo has no public bucket access configured, so the
// dashboard needs some way to display them — this is that way. Only serves
// the prefixes the dashboard actually needs; anything else 403s so this
// can't become an open proxy over the whole bucket.
//
// Streams object.body directly into the Response, never buffers — same
// principle already used for the YouTube upload PUT in lib/youtube-publish.js.

const ALLOWED_PREFIXES = ['thumbnails/', 'clips/', 'videos/', 'faces/'];

const EXTENSION_CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
};

// Error responses must never be cached by Cloudflare's edge -- a stale
// negative result (e.g. "no object at this key") would keep being served
// long after the underlying cause is fixed, since nothing about a 404
// naturally expires the way real content changes do. Confirmed live: a
// 404 here defaulted to a multi-hour edge cache with no explicit directive
// telling it not to.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function onRequestGet(context) {
  const { env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  // Cloudflare Pages' [[path]] catch-all does NOT auto-decode percent-
  // encoded segments (verified live) -- without this, a filename with
  // spaces/commas (e.g. an image exported from ChatGPT) fails to look up
  // in R2 because the key still has the raw %20/%2C in it.
  const key = segments.map(decodeURIComponent).join('/');

  if (!ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix))) {
    return Response.json({ error: `Refusing to serve key outside ${ALLOWED_PREFIXES.join(', ')}` }, { status: 403, headers: NO_STORE });
  }

  const object = await env.MEDIA.get(key);
  if (!object) {
    return Response.json({ error: `No object at "${key}"` }, { status: 404, headers: NO_STORE });
  }

  const extension = key.split('.').pop().toLowerCase();
  const contentType = object.httpMetadata?.contentType || EXTENSION_CONTENT_TYPES[extension] || 'application/octet-stream';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(object.size),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
