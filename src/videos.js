// Video pipeline dashboard: one page, two views toggled by the `?id=`
// query param (list when absent, detail when present) — mirrors the
// existing topics dashboard's single-page-per-concern style rather than
// adding a client-side router.
//
// Detail-view pattern: after every mutating action (generate/thumbnail/
// select/publish/repurpose/approve), re-fetch the full record via
// GET /api/videos/<id> and re-render everything from that, rather than
// hand-merging each route's partial response shape — the routes return
// different subsets of fields, so one source of truth is simpler and safer.

const STATUS_LABELS = {
  uploading: 'Uploading',
  upload_failed: 'Upload failed',
  uploaded: 'Uploaded',
  metadata_generated: 'Metadata locked',
  published: 'Published',
  staged: 'Staged',
  approved: 'Approved',
  rejected: 'Rejected',
};

const els = {
  errorBanner: document.getElementById('error-banner'),
  listView: document.getElementById('list-view'),
  detailView: document.getElementById('detail-view'),
  fileInput: document.getElementById('file-input'),
  uploadBtn: document.getElementById('upload-btn'),
  uploadDropzone: document.getElementById('upload-dropzone'),
  uploadProgressWrap: document.getElementById('upload-progress-wrap'),
  uploadProgressFill: document.getElementById('upload-progress-fill'),
  uploadProgressLabel: document.getElementById('upload-progress-label'),
  abortUploadBtn: document.getElementById('abort-upload-btn'),
  reloadListBtn: document.getElementById('reload-list-btn'),
  videosTable: document.getElementById('videos-table'),
  videosBody: document.getElementById('videos-body'),
  videosEmptyState: document.getElementById('videos-empty-state'),
  videoStatusBadge: document.getElementById('video-status-badge'),
  uploadSectionBody: document.getElementById('upload-section-body'),
  metadataSectionBody: document.getElementById('metadata-section-body'),
  publishSectionBody: document.getElementById('publish-section-body'),
  repurposeSectionBody: document.getElementById('repurpose-section-body'),
};

// Metadata selection state — only meaningful before metadata is locked in.
// Reset every time a video is (re)loaded.
let metadataSelection = { title: null, description: null, thumbnailR2Key: null, thumbnailText: null, faceR2Key: null };
let currentUpload = { videoId: null, aborted: false };
let currentDetailVideoId = null;

// Presenter-photo gallery — fetched once and cached; null means "not loaded
// yet". A separate loading flag stops concurrent renders from firing the
// same fetch twice.
let faceOptions = null;
let faceOptionsLoading = false;

function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.style.display = 'block';
}

function clearError() {
  els.errorBanner.style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = n;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

function formatSeconds(seconds) {
  const s = Math.floor(seconds || 0);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function statusBadge(status) {
  return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function apiFetch(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function getVideoIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

// ─── Routing ────────────────────────────────────────────────────────────

function init() {
  const id = getVideoIdFromUrl();
  if (id) {
    els.listView.style.display = 'none';
    els.detailView.style.display = 'block';
    loadVideoDetail(id);
  } else {
    els.listView.style.display = 'block';
    els.detailView.style.display = 'none';
    loadVideosList();
  }
}

// ─── List view ──────────────────────────────────────────────────────────

async function loadVideosList() {
  clearError();
  els.videosEmptyState.textContent = 'Loading videos…';
  try {
    const data = await apiFetch('/api/videos');
    renderVideosList(data.videos || []);
  } catch (err) {
    showError(err.message);
    els.videosEmptyState.textContent = 'Failed to load videos.';
  }
}

function renderVideosList(videos) {
  if (videos.length === 0) {
    els.videosTable.style.display = 'none';
    els.videosEmptyState.style.display = 'block';
    els.videosEmptyState.textContent = 'No videos yet — upload one above.';
    return;
  }

  const sorted = [...videos].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  els.videosEmptyState.style.display = 'none';
  els.videosTable.style.display = 'table';
  els.videosBody.innerHTML = '';

  for (const video of sorted) {
    const row = document.createElement('tr');
    row.className = 'clickable';
    row.innerHTML = `
      <td>${escapeHtml(video.filename)}</td>
      <td>${statusBadge(video.status)}</td>
      <td>${formatDate(video.updatedAt)}</td>
    `;
    row.addEventListener('click', () => {
      window.location.href = `videos.html?id=${encodeURIComponent(video.id)}`;
    });
    els.videosBody.appendChild(row);
  }
}

// ─── Upload flow ────────────────────────────────────────────────────────

async function onUploadClick() {
  const file = els.fileInput.files[0];
  if (!file) {
    showError('Choose a file first.');
    return;
  }
  startUpload(file);
}

async function startUpload(file) {
  clearError();
  els.uploadBtn.disabled = true;
  els.uploadProgressWrap.style.display = 'block';
  currentUpload = { videoId: null, aborted: false };

  try {
    const start = await apiFetch('/api/upload/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, sizeBytes: file.size, mimeType: file.type || 'application/octet-stream' }),
    });
    currentUpload.videoId = start.videoId;

    const partSize = start.recommendedPartSizeBytes;
    const totalParts = Math.ceil(file.size / partSize);

    for (let i = 0; i < totalParts; i++) {
      if (currentUpload.aborted) return;
      const partNumber = i + 1;
      const chunk = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
      await uploadPartWithRetry(start.videoId, partNumber, chunk);
      updateUploadProgress(partNumber, totalParts);
    }

    if (currentUpload.aborted) return;

    els.uploadProgressLabel.textContent = 'Finalizing…';
    await apiFetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: start.videoId }),
    });

    window.location.href = `videos.html?id=${encodeURIComponent(start.videoId)}`;
  } catch (err) {
    showError(`Upload failed: ${err.message}`);
    els.uploadBtn.disabled = false;
    els.uploadProgressWrap.style.display = 'none';
  }
}

async function uploadPartWithRetry(videoId, partNumber, chunk, attempt = 1) {
  try {
    await apiFetch(`/api/upload/part?videoId=${encodeURIComponent(videoId)}&partNumber=${partNumber}`, {
      method: 'POST',
      body: chunk,
    });
  } catch (err) {
    if (attempt >= 3) throw err;
    await uploadPartWithRetry(videoId, partNumber, chunk, attempt + 1);
  }
}

function updateUploadProgress(partsDone, totalParts) {
  const pct = Math.round((partsDone / totalParts) * 100);
  els.uploadProgressFill.style.width = `${pct}%`;
  els.uploadProgressLabel.textContent = `Uploading… ${partsDone}/${totalParts} parts (${pct}%)`;
}

async function onAbortUpload() {
  if (!currentUpload.videoId) return;
  currentUpload.aborted = true;
  try {
    await apiFetch('/api/upload/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: currentUpload.videoId }),
    });
  } catch (err) {
    showError(err.message);
  }
  els.uploadBtn.disabled = false;
  els.uploadProgressWrap.style.display = 'none';
  loadVideosList();
}

// ─── Detail view ────────────────────────────────────────────────────────

async function loadVideoDetail(id) {
  clearError();
  try {
    const video = await apiFetch(`/api/videos/${encodeURIComponent(id)}`);
    if (id !== currentDetailVideoId) {
      metadataSelection = { title: null, description: null, thumbnailR2Key: null, thumbnailText: null, faceR2Key: null };
      currentDetailVideoId = id;
    }
    renderDetail(video);
  } catch (err) {
    showError(err.message);
  }
}

function renderDetail(video) {
  els.videoStatusBadge.className = `status-badge status-${video.status}`;
  els.videoStatusBadge.textContent = STATUS_LABELS[video.status] || video.status;

  renderUploadSection(video);
  renderMetadataSection(video);
  renderPublishSection(video);
  renderRepurposeSection(video);
}

function renderUploadSection(video) {
  if (video.status === 'uploading') {
    const state = video.uploadState || { partsUploaded: [], bytesUploaded: 0 };
    els.uploadSectionBody.innerHTML = `
      <div>${escapeHtml(video.filename)} — ${formatBytes(video.sizeBytes)}</div>
      <div class="hint">${state.partsUploaded.length} part(s) uploaded so far. Resuming requires re-selecting the
      same file from the list page — browsers can't reattach a file after a reload.</div>
    `;
  } else if (video.status === 'upload_failed') {
    els.uploadSectionBody.innerHTML = `
      <div>${escapeHtml(video.filename)} — upload was aborted or failed.</div>
      <div class="hint">Start a fresh upload from the video list — this record can't be resumed.</div>
    `;
  } else {
    els.uploadSectionBody.innerHTML = `
      <div>${escapeHtml(video.filename)} — ${formatBytes(video.sizeBytes)} — ${escapeHtml(video.mimeType)}</div>
      <div class="hint">Uploaded ${formatDate(video.createdAt)}</div>
    `;
  }
}

function ensureFaceOptions(onLoaded) {
  if (faceOptions !== null || faceOptionsLoading) return;
  faceOptionsLoading = true;
  apiFetch('/api/media/faces')
    .then(data => { faceOptions = data.faces || []; })
    .catch(() => { faceOptions = []; })
    .finally(() => {
      faceOptionsLoading = false;
      if (onLoaded) onLoaded();
    });
}

function renderFaceGrid() {
  if (faceOptions === null) {
    return `<div class="hint">Loading presenter photos…</div>`;
  }
  if (faceOptions.length === 0) {
    return `<div class="hint">No presenter photos yet — upload some to the MEDIA bucket's faces/ folder in the Cloudflare R2 browser to enable this.</div>`;
  }

  const noneSelected = !metadataSelection.faceR2Key;
  let html = `<div class="thumbnail-grid">`;
  html += `
    <div class="thumbnail-candidate face-candidate${noneSelected ? ' selected' : ''}" data-r2key="">
      <div class="no-face-tile">No photo</div>
    </div>
  `;
  for (const face of faceOptions) {
    const selected = metadataSelection.faceR2Key === face.key;
    html += `
      <div class="thumbnail-candidate face-candidate${selected ? ' selected' : ''}" data-r2key="${escapeHtml(face.key)}">
        <img src="${escapeHtml(face.url)}" alt="Presenter photo">
      </div>
    `;
  }
  html += `</div>`;
  return html;
}

function renderMetadataSection(video) {
  if (video.status === 'uploading' || video.status === 'upload_failed') {
    els.metadataSectionBody.innerHTML = `<div class="hint">Available once the upload finishes.</div>`;
    return;
  }

  const isLocked = video.status === 'metadata_generated' || video.status === 'published';
  const meta = video.metadata;

  if (isLocked && meta) {
    els.metadataSectionBody.innerHTML = `
      <div class="locked-summary">
        <div class="field-label">Title</div><div>${escapeHtml(meta.selectedTitle)}</div>
        <div class="field-label">Description</div><div>${escapeHtml(meta.selectedDescription)}</div>
        <div class="field-label">Thumbnail text</div><div>${escapeHtml(meta.selectedThumbnailText)}</div>
        <div class="field-label">Thumbnail</div>
        <img src="/api/media/${escapeHtml(meta.selectedThumbnailR2Key)}" alt="Selected thumbnail">
      </div>
    `;
    return;
  }

  const hasOptions = meta && meta.titleOptions && meta.titleOptions.length > 0;
  let html = `<div class="field-row"><button id="generate-metadata-btn" class="primary">Generate title/description/thumbnail-text options</button></div>`;

  if (hasOptions) {
    html += renderOptionList('title-option', meta.titleOptions, metadataSelection.title);
    html += `<div class="field-label" style="color:var(--muted);font-size:11px;margin:10px 0 4px;">Description options</div>`;
    html += renderOptionList('description-option', meta.descriptionOptions, metadataSelection.description);

    html += `<div class="field-label" style="color:var(--muted);font-size:11px;margin:14px 0 4px;">Thumbnail text options (click to fill the field below)</div>`;
    html += `<div class="field-row">`;
    for (const text of meta.thumbnailTextOptions) {
      html += `<button class="thumbnail-text-chip" data-text="${escapeHtml(text)}" type="button">${escapeHtml(text)}</button>`;
    }
    html += `</div>`;

    html += `<div class="field-label" style="color:var(--muted);font-size:11px;margin:14px 0 4px;">Presenter photo (optional)</div>`;
    html += renderFaceGrid();
    if (faceOptions === null) {
      ensureFaceOptions(() => renderMetadataSection(video));
    }

    html += `
      <div class="field-row">
        <input type="text" id="thumbnail-text-input" placeholder="THUMBNAIL TEXT (2-4 words, ALL CAPS)">
        <input type="text" id="thumbnail-prompt-input" placeholder="Background image prompt (optional)">
        <button id="generate-thumbnail-btn">Generate thumbnail</button>
      </div>
    `;

    if (meta.thumbnailCandidates && meta.thumbnailCandidates.length > 0) {
      html += `<div class="thumbnail-grid">`;
      for (const candidate of meta.thumbnailCandidates) {
        const selected = metadataSelection.thumbnailR2Key === candidate.r2Key;
        html += `
          <div class="thumbnail-candidate${selected ? ' selected' : ''}" data-r2key="${escapeHtml(candidate.r2Key)}" data-text="${escapeHtml(candidate.thumbnailText)}">
            <img src="/api/media/${escapeHtml(candidate.r2Key)}" alt="Thumbnail candidate">
            <div class="label">${escapeHtml(candidate.thumbnailText)}</div>
          </div>
        `;
      }
      html += `</div>`;
    }

    html += `<div class="field-row" style="margin-top:12px;"><button id="lock-in-metadata-btn" class="primary">Lock in selections</button></div>`;
  }

  els.metadataSectionBody.innerHTML = html;

  document.getElementById('generate-metadata-btn').addEventListener('click', () => onGenerateMetadata(video.id));

  if (hasOptions) {
    wireOptionList('title-option', value => { metadataSelection.title = value; });
    wireOptionList('description-option', value => { metadataSelection.description = value; });

    document.querySelectorAll('.thumbnail-text-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('thumbnail-text-input').value = btn.dataset.text;
      });
    });

    document.querySelectorAll('.face-candidate').forEach(el => {
      el.addEventListener('click', () => {
        metadataSelection.faceR2Key = el.dataset.r2key || null;
        document.querySelectorAll('.face-candidate').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    document.getElementById('generate-thumbnail-btn').addEventListener('click', () => onGenerateThumbnail(video.id));

    document.querySelectorAll('.thumbnail-grid .thumbnail-candidate:not(.face-candidate)').forEach(el => {
      el.addEventListener('click', () => {
        metadataSelection.thumbnailR2Key = el.dataset.r2key;
        metadataSelection.thumbnailText = el.dataset.text;
        document.querySelectorAll('.thumbnail-grid .thumbnail-candidate:not(.face-candidate)').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    document.getElementById('lock-in-metadata-btn').addEventListener('click', () => onLockInMetadata(video.id));
  }
}

function renderOptionList(name, options, selectedValue) {
  let html = `<div class="option-list">`;
  for (const option of options) {
    const checked = option === selectedValue ? 'checked' : '';
    html += `
      <label class="option-card${option === selectedValue ? ' selected' : ''}">
        <input type="radio" name="${name}" value="${escapeHtml(option)}" ${checked}>
        <span>${escapeHtml(option)}</span>
      </label>
    `;
  }
  html += `</div>`;
  return html;
}

function wireOptionList(name, onSelect) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
    input.addEventListener('change', () => {
      onSelect(input.value);
      input.closest('.option-list').querySelectorAll('.option-card').forEach(card => card.classList.remove('selected'));
      input.closest('.option-card').classList.add('selected');
    });
  });
}

async function onGenerateMetadata(videoId) {
  clearError();
  const btn = document.getElementById('generate-metadata-btn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const result = await apiFetch('/api/metadata/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    if (result.validation && result.validation.warnings && result.validation.warnings.length > 0) {
      showError(`Generated with warnings: ${result.validation.warnings.join('; ')}`);
    }
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Generate title/description/thumbnail-text options';
  }
}

async function onGenerateThumbnail(videoId) {
  clearError();
  const thumbnailText = document.getElementById('thumbnail-text-input').value.trim();
  const backgroundPrompt = document.getElementById('thumbnail-prompt-input').value.trim();
  if (!thumbnailText) {
    showError('Enter or pick thumbnail text first.');
    return;
  }
  const btn = document.getElementById('generate-thumbnail-btn');
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    await apiFetch('/api/metadata/thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        thumbnailText,
        backgroundPrompt: backgroundPrompt || undefined,
        faceR2Key: metadataSelection.faceR2Key || undefined,
      }),
    });
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.data && err.data.issues ? `${err.message}: ${err.data.issues.join('; ')}` : err.message);
    btn.disabled = false;
    btn.textContent = 'Generate thumbnail';
  }
}

async function onLockInMetadata(videoId) {
  clearError();
  if (!metadataSelection.title || !metadataSelection.description || !metadataSelection.thumbnailR2Key) {
    showError('Pick a title, a description, and a thumbnail image before locking in.');
    return;
  }
  const btn = document.getElementById('lock-in-metadata-btn');
  btn.disabled = true;
  try {
    await apiFetch('/api/metadata/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        selectedTitle: metadataSelection.title,
        selectedDescription: metadataSelection.description,
        selectedThumbnailText: metadataSelection.thumbnailText,
        selectedThumbnailR2Key: metadataSelection.thumbnailR2Key,
      }),
    });
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.data && err.data.issues ? `${err.message}: ${err.data.issues.join('; ')}` : err.message);
    btn.disabled = false;
  }
}

function renderPublishSection(video) {
  if (video.status === 'published' && video.youtube) {
    els.publishSectionBody.innerHTML = `
      <div>Published ${formatDate(video.youtube.publishedAt)} — visibility: ${escapeHtml(video.youtube.privacyStatus)}</div>
      <div class="field-row"><a href="${escapeHtml(video.youtube.url)}" target="_blank" rel="noopener">${escapeHtml(video.youtube.url)}</a></div>
    `;
    return;
  }

  if (video.status !== 'metadata_generated') {
    els.publishSectionBody.innerHTML = `<div class="hint">Available once metadata is locked in (step 2).</div>`;
    return;
  }

  els.publishSectionBody.innerHTML = `
    <div class="field-row">
      <select id="privacy-select">
        <option value="private" selected>Private</option>
        <option value="unlisted">Unlisted</option>
        <option value="public">Public</option>
      </select>
      <button id="publish-youtube-btn" class="primary">Publish to YouTube</button>
    </div>
  `;
  document.getElementById('publish-youtube-btn').addEventListener('click', () => onPublishYoutube(video.id));
}

async function onPublishYoutube(videoId) {
  clearError();
  const btn = document.getElementById('publish-youtube-btn');
  const privacyStatus = document.getElementById('privacy-select').value;
  btn.disabled = true;
  btn.textContent = 'Publishing…';
  try {
    await apiFetch('/api/publish-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, privacyStatus }),
    });
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Publish to YouTube';
  }
}

function renderRepurposeSection(video) {
  if (video.status === 'uploading') {
    els.repurposeSectionBody.innerHTML = `<div class="hint">Available once the upload finishes.</div>`;
    return;
  }

  let html = `<div class="field-row"><button id="generate-clips-btn">Generate clips from transcript</button></div>`;

  if (video.clips && video.clips.length > 0) {
    html += `<div class="clip-grid">`;
    for (const clip of video.clips) {
      html += renderClipCard(video.id, clip);
    }
    html += `</div>`;
  }

  els.repurposeSectionBody.innerHTML = html;

  document.getElementById('generate-clips-btn').addEventListener('click', () => onGenerateClips(video.id));

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.caption));
  });
  document.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', () => onApproveClip(video.id, btn.dataset.clipId, true));
  });
  document.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', () => onApproveClip(video.id, btn.dataset.clipId, false));
  });
  document.querySelectorAll('.publish-clip-btn').forEach(btn => {
    btn.addEventListener('click', () => onPublishClip(video.id, btn.dataset.clipId, btn.dataset.platform));
  });
}

function renderClipCard(videoId, clip) {
  const timeRange = `${formatSeconds(clip.startSeconds)} – ${formatSeconds(clip.startSeconds + clip.durationSeconds)}`;
  const isApproved = clip.status === 'approved';
  const isDecided = clip.status === 'approved' || clip.status === 'rejected' || clip.status === 'published';

  let captionsHtml = '';
  for (const platform of ['tiktok', 'instagram', 'linkedin']) {
    const caption = clip.captions ? clip.captions[platform] : '';
    const published = clip.publishedTo && clip.publishedTo[platform];
    captionsHtml += `
      <div class="caption-block">
        <div class="platform">
          <span>${platform}${platform === 'linkedin' ? ' (manual)' : ''}${published ? ' ✓ published' : ''}</span>
          <button class="copy-btn" type="button" data-caption="${escapeHtml(caption)}">Copy</button>
        </div>
        <div>${escapeHtml(caption)}</div>
      </div>
    `;
  }

  let actionsHtml = `<div class="clip-actions">`;
  if (!isDecided) {
    actionsHtml += `<button class="approve-btn" data-clip-id="${escapeHtml(clip.id)}">Approve</button>`;
    actionsHtml += `<button class="reject-btn" data-clip-id="${escapeHtml(clip.id)}">Reject</button>`;
  } else if (isApproved || clip.status === 'published') {
    for (const platform of ['tiktok', 'instagram']) {
      const published = clip.publishedTo && clip.publishedTo[platform];
      actionsHtml += `<button class="publish-clip-btn" data-clip-id="${escapeHtml(clip.id)}" data-platform="${platform}" ${published ? 'disabled' : ''}>${published ? `Published to ${platform}` : `Publish to ${platform}`}</button>`;
    }
  }
  actionsHtml += `</div>`;

  return `
    <div class="clip-card">
      <video src="/api/media/${escapeHtml(clip.r2Key)}" controls preload="none"></video>
      <div>${statusBadge(clip.status)} ${escapeHtml(timeRange)}</div>
      <div class="transcript">"${escapeHtml(clip.transcriptExcerpt)}"</div>
      ${captionsHtml}
      ${actionsHtml}
    </div>
  `;
}

async function onGenerateClips(videoId) {
  clearError();
  const btn = document.getElementById('generate-clips-btn');
  btn.disabled = true;
  btn.textContent = 'Generating clips… this can take a while';
  try {
    const result = await apiFetch('/api/repurpose/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    if (result.errors && result.errors.length > 0) {
      showError(`Generated ${result.clipsGenerated} clip(s), but some failed: ${result.errors.join('; ')}`);
    }
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.data && err.data.errors ? `${err.message}: ${err.data.errors.join('; ')}` : err.message);
    btn.disabled = false;
    btn.textContent = 'Generate clips from transcript';
  }
}

async function onApproveClip(videoId, clipId, approved) {
  clearError();
  try {
    await apiFetch('/api/repurpose/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, clipId, approved }),
    });
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.message);
  }
}

async function onPublishClip(videoId, clipId, platform) {
  clearError();
  try {
    await apiFetch('/api/repurpose/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, clipId, platform }),
    });
    await loadVideoDetail(videoId);
  } catch (err) {
    showError(err.message);
  }
}

// ─── Drag-and-drop upload ─────────────────────────────────────────────
// Dragging over the whole document (not just the dropzone) so a file
// dropped slightly outside the box doesn't silently navigate the tab away
// — the browser's default for an undropped file is to open it.

let dragDepth = 0;

document.addEventListener('dragenter', e => {
  if (!els.uploadDropzone || els.listView.style.display === 'none') return;
  e.preventDefault();
  dragDepth++;
  els.uploadDropzone.classList.add('drag-over');
});

document.addEventListener('dragover', e => {
  e.preventDefault();
});

document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0 && els.uploadDropzone) {
    els.uploadDropzone.classList.remove('drag-over');
  }
});

document.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  if (els.uploadDropzone) els.uploadDropzone.classList.remove('drag-over');
  if (els.listView.style.display === 'none') return;
  const file = e.dataTransfer.files[0];
  if (file) startUpload(file);
});

// ─── Wire up static elements ────────────────────────────────────────────

els.uploadBtn.addEventListener('click', onUploadClick);
els.abortUploadBtn.addEventListener('click', onAbortUpload);
els.reloadListBtn.addEventListener('click', loadVideosList);

init();
