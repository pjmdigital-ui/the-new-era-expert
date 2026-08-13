/**
 * YouTube Data API v3 publish flow — the resumable upload protocol plus
 * setting a custom thumbnail. Network calls are injectable (fetchFn) so
 * this is testable without a real API key, matching lib/topic-agent.js's
 * pattern of separating network calls from orchestration.
 */

const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

/**
 * Step 1 of the resumable upload protocol: initiate a session and return
 * the session upload URL from the response's Location header.
 *
 * @param {{title: string, description: string, categoryId: string, privacyStatus: string}} metadata
 * @param {number} sizeBytes
 * @param {string} mimeType
 * @param {string} accessToken
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>} the session upload URL
 */
async function startResumableUpload(metadata, sizeBytes, mimeType, accessToken, fetchFn = fetch) {
  const res = await fetchFn(`${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-upload-content-length': String(sizeBytes),
      'x-upload-content-type': mimeType,
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title,
        description: metadata.description,
        categoryId: metadata.categoryId,
      },
      status: { privacyStatus: metadata.privacyStatus },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to start YouTube resumable upload: ${res.status} ${await res.text()}`);
  }

  const location = res.headers.get('location');
  if (!location) {
    throw new Error('YouTube resumable upload response had no Location header');
  }
  return location;
}

/**
 * Step 2: PUT the video bytes to the session URL from startResumableUpload.
 * Takes the R2 object body stream directly — never buffer the whole file
 * in Worker memory (an 8-15 minute video would risk the ~128MB isolate
 * memory ceiling).
 *
 * @param {string} uploadUrl
 * @param {ReadableStream} bodyStream
 * @param {number} sizeBytes
 * @param {string} mimeType
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{videoId: string}>}
 */
async function uploadVideoBytes(uploadUrl, bodyStream, sizeBytes, mimeType, fetchFn = fetch) {
  const res = await fetchFn(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': String(sizeBytes),
      'content-type': mimeType,
    },
    body: bodyStream,
  });

  if (!res.ok) {
    throw new Error(`YouTube video upload failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.id) {
    throw new Error('YouTube upload response had no video id');
  }
  return { videoId: data.id };
}

/**
 * @param {string} accessToken
 * @param {string} youtubeVideoId
 * @param {Uint8Array} pngBytes
 * @param {typeof fetch} [fetchFn]
 */
async function setThumbnail(accessToken, youtubeVideoId, pngBytes, fetchFn = fetch) {
  const res = await fetchFn(`${UPLOAD_BASE}/thumbnails/set?videoId=${youtubeVideoId}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'image/png',
    },
    body: pngBytes,
  });

  if (!res.ok) {
    throw new Error(`Failed to set YouTube thumbnail: ${res.status} ${await res.text()}`);
  }
}

module.exports = { startResumableUpload, uploadVideoBytes, setThumbnail };
