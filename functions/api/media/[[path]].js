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

export async function onRequestGet(context) {
  const { env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const key = segments.join('/');

  if (!ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix))) {
    return Response.json({ error: `Refusing to serve key outside ${ALLOWED_PREFIXES.join(', ')}` }, { status: 403 });
  }

  const object = await env.MEDIA.get(key);
  if (!object) {
    return Response.json({ error: `No object at "${key}"` }, { status: 404 });
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
