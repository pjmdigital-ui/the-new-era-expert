// GET /api/media/faces -> lists presenter photos uploaded to the MEDIA
// bucket's faces/ prefix, so the metadata UI's photo picker can discover
// whatever's there without any hardcoded filenames. To add or remove
// photos, use the Cloudflare dashboard's R2 object browser on the faces/
// folder — no code change needed, they show up here automatically.

export async function onRequestGet(context) {
  const { env } = context;
  const listed = await env.MEDIA.list({ prefix: 'faces/' });
  const faces = (listed.objects || [])
    .filter(o => !o.key.endsWith('/'))
    .map(o => ({
      key: o.key,
      // Percent-encode each path segment -- filenames like "ChatGPT Image
      // Aug 19, 2026, 02_48_00 PM.png" (spaces, commas) break as a raw
      // <img src> otherwise. Split/join around "/" so the faces/ separator
      // itself doesn't get encoded into %2F.
      url: `/api/media/${o.key.split('/').map(encodeURIComponent).join('/')}`,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return Response.json({ faces });
}
