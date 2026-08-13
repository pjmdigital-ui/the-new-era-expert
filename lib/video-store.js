/**
 * Per-record KV store for the video pipeline — every upload/metadata/publish/
 * repurpose route reads and writes video state exclusively through this
 * module, extending the same single-source-of-truth rule lib/topics-store.js
 * already applies to topics.
 *
 * Unlike topics (a fixed 42-item list re-ranked as one blob on every write),
 * videos accumulate indefinitely and different routes patch different videos
 * concurrently (e.g. an upload completing for one video while metadata
 * generates for another) — a single shared blob would let those concurrent
 * writes silently clobber each other. Each video gets its own KV key instead;
 * a lightweight index key lists every video for the dashboard without
 * hydrating every full record. (Two writes to the *same* video record can
 * still race — same posture topics-store.js already accepts for its one key.)
 */

const KV_PREFIX = 'video:';
const INDEX_KEY = 'videos:index';

function videoKey(id) {
  return `${KV_PREFIX}${id}`;
}

function emptyRecord({ id, filename, sizeBytes, mimeType, r2Key, r2UploadId }) {
  const now = new Date().toISOString();
  return {
    id,
    filename,
    sizeBytes,
    mimeType,
    r2Key,
    status: 'uploading',
    uploadState: { r2UploadId: r2UploadId || null, partsUploaded: [], bytesUploaded: 0 },
    metadata: null,
    youtube: null,
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
}

function toSummary(record) {
  return {
    id: record.id,
    filename: record.filename,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function readIndex(env) {
  const index = await env.CONTENT_KV.get(INDEX_KEY, 'json');
  return Array.isArray(index) ? index : [];
}

async function writeIndexEntry(env, summary) {
  const index = await readIndex(env);
  const pos = index.findIndex(entry => entry.id === summary.id);
  if (pos === -1) {
    index.push(summary);
  } else {
    index[pos] = summary;
  }
  await env.CONTENT_KV.put(INDEX_KEY, JSON.stringify(index));
}

/**
 * @param {{id?: string, filename: string, sizeBytes: number, mimeType: string, r2Key: string, r2UploadId?: string}} params
 * `id` is optional — pass one when the caller needs the id before the record
 * exists (e.g. to embed it in the R2 key used to open a multipart upload).
 */
async function createVideo(env, { id, filename, sizeBytes, mimeType, r2Key, r2UploadId }) {
  const record = emptyRecord({ id: id || crypto.randomUUID(), filename, sizeBytes, mimeType, r2Key, r2UploadId });
  await saveVideo(env, record);
  return record;
}

async function getVideo(env, id) {
  return env.CONTENT_KV.get(videoKey(id), 'json');
}

async function saveVideo(env, record) {
  record.updatedAt = new Date().toISOString();
  await env.CONTENT_KV.put(videoKey(record.id), JSON.stringify(record));
  await writeIndexEntry(env, toSummary(record));
  return record;
}

async function listVideos(env, { status } = {}) {
  const index = await readIndex(env);
  return status ? index.filter(entry => entry.status === status) : index;
}

async function updateVideoStatus(env, id, status, patch = {}) {
  const record = await getVideo(env, id);
  if (!record) return null;
  const updated = { ...record, ...patch, status };
  await saveVideo(env, updated);
  return updated;
}

async function addClips(env, videoId, clips) {
  const record = await getVideo(env, videoId);
  if (!record) return null;
  record.clips = [...record.clips, ...clips];
  await saveVideo(env, record);
  return record;
}

async function updateClip(env, videoId, clipId, patch) {
  const record = await getVideo(env, videoId);
  if (!record) return null;
  const found = record.clips.some(clip => clip.id === clipId);
  if (!found) return null;
  record.clips = record.clips.map(clip => (clip.id === clipId ? { ...clip, ...patch } : clip));
  await saveVideo(env, record);
  return record;
}

module.exports = {
  KV_PREFIX,
  INDEX_KEY,
  createVideo,
  getVideo,
  saveVideo,
  listVideos,
  updateVideoStatus,
  addClips,
  updateClip,
};
