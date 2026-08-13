const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createVideo,
  getVideo,
  listVideos,
  updateVideoStatus,
  addClips,
  updateClip,
} = require('./video-store.js');

function fakeEnv() {
  const store = new Map();
  return {
    CONTENT_KV: {
      async get(key, type) {
        const value = store.get(key);
        if (value === undefined) return null;
        return type === 'json' ? JSON.parse(value) : value;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
  };
}

test('createVideo persists a record with status "uploading" and appears in listVideos', async () => {
  const env = fakeEnv();
  const record = await createVideo(env, {
    filename: 'talk.mp4',
    sizeBytes: 1000,
    mimeType: 'video/mp4',
    r2Key: 'videos/x/talk.mp4',
    r2UploadId: 'upload-1',
  });

  assert.equal(record.status, 'uploading');
  assert.equal(record.uploadState.r2UploadId, 'upload-1');
  assert.deepEqual(record.clips, []);
  assert.equal(record.metadata, null);

  const fetched = await getVideo(env, record.id);
  assert.deepEqual(fetched, record);

  const listed = await listVideos(env);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, record.id);
  assert.equal(listed[0].status, 'uploading');
});

test('getVideo returns null for an unknown id', async () => {
  const env = fakeEnv();
  const result = await getVideo(env, 'does-not-exist');
  assert.equal(result, null);
});

test('updateVideoStatus transitions status and merges patch fields without dropping others', async () => {
  const env = fakeEnv();
  const record = await createVideo(env, {
    filename: 'talk.mp4',
    sizeBytes: 1000,
    mimeType: 'video/mp4',
    r2Key: 'videos/x/talk.mp4',
  });

  const updated = await updateVideoStatus(env, record.id, 'uploaded', { uploadState: null });
  assert.equal(updated.status, 'uploaded');
  assert.equal(updated.uploadState, null);
  assert.equal(updated.filename, 'talk.mp4');
  assert.equal(updated.r2Key, 'videos/x/talk.mp4');

  const fetched = await getVideo(env, record.id);
  assert.equal(fetched.status, 'uploaded');
});

test('updateVideoStatus returns null for an unknown id and does not throw', async () => {
  const env = fakeEnv();
  const result = await updateVideoStatus(env, 'nope', 'uploaded');
  assert.equal(result, null);
});

test('addClips appends without clobbering existing clips', async () => {
  const env = fakeEnv();
  const record = await createVideo(env, {
    filename: 'talk.mp4',
    sizeBytes: 1000,
    mimeType: 'video/mp4',
    r2Key: 'videos/x/talk.mp4',
  });

  await addClips(env, record.id, [{ id: 'c1', status: 'staged' }]);
  const after = await addClips(env, record.id, [{ id: 'c2', status: 'staged' }]);

  assert.equal(after.clips.length, 2);
  assert.deepEqual(after.clips.map(c => c.id), ['c1', 'c2']);
});

test('updateClip patches only the matching clip and leaves siblings untouched', async () => {
  const env = fakeEnv();
  const record = await createVideo(env, {
    filename: 'talk.mp4',
    sizeBytes: 1000,
    mimeType: 'video/mp4',
    r2Key: 'videos/x/talk.mp4',
  });
  await addClips(env, record.id, [
    { id: 'c1', status: 'staged' },
    { id: 'c2', status: 'staged' },
  ]);

  const after = await updateClip(env, record.id, 'c1', { status: 'approved' });
  assert.equal(after.clips.find(c => c.id === 'c1').status, 'approved');
  assert.equal(after.clips.find(c => c.id === 'c2').status, 'staged');
});

test('updateClip returns null when the clip id does not exist on the video', async () => {
  const env = fakeEnv();
  const record = await createVideo(env, {
    filename: 'talk.mp4',
    sizeBytes: 1000,
    mimeType: 'video/mp4',
    r2Key: 'videos/x/talk.mp4',
  });
  const result = await updateClip(env, record.id, 'no-such-clip', { status: 'approved' });
  assert.equal(result, null);
});

test('listVideos filters by status', async () => {
  const env = fakeEnv();
  const a = await createVideo(env, { filename: 'a.mp4', sizeBytes: 1, mimeType: 'video/mp4', r2Key: 'a' });
  const b = await createVideo(env, { filename: 'b.mp4', sizeBytes: 1, mimeType: 'video/mp4', r2Key: 'b' });
  await updateVideoStatus(env, a.id, 'uploaded', { uploadState: null });

  const uploading = await listVideos(env, { status: 'uploading' });
  const uploaded = await listVideos(env, { status: 'uploaded' });

  assert.equal(uploading.length, 1);
  assert.equal(uploading[0].id, b.id);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].id, a.id);
});

test('writes to one video record never clobber a different video\'s record (per-record keys, not one shared blob)', async () => {
  const env = fakeEnv();
  const a = await createVideo(env, { filename: 'a.mp4', sizeBytes: 1, mimeType: 'video/mp4', r2Key: 'a' });
  const b = await createVideo(env, { filename: 'b.mp4', sizeBytes: 1, mimeType: 'video/mp4', r2Key: 'b' });

  await updateVideoStatus(env, a.id, 'uploaded', { uploadState: null });

  const bStillIntact = await getVideo(env, b.id);
  assert.equal(bStillIntact.status, 'uploading');
  assert.notEqual(bStillIntact.uploadState, null);
});
