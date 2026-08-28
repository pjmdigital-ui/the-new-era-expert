const ENTRY_POINT_LABELS = {
  'problem-is-real': 'Problem is real',
  'alternatives-fail': 'Alternatives fail',
  'category-exists': 'Category exists',
  'credible-and-different': 'Credible & different',
  'i-am-capable': 'I am capable',
  'act-now': 'Act now',
  'proof-premise-7-8': 'Proof (Premise 7/8)',
};

const ANGLE_LABELS = {
  'pain-avoidance': 'Pain',
  'pleasure-seeking': 'Pleasure',
};

function angleBadge(angle) {
  if (!angle) return '';
  const label = ANGLE_LABELS[angle] || angle;
  const cls = angle === 'pleasure-seeking' ? 'entry-tag angle-pleasure' : 'entry-tag';
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

const els = {
  errorBanner: document.getElementById('error-banner'),
  nextUpCard: document.getElementById('next-up-card'),
  nextUpTitle: document.getElementById('next-up-title'),
  nextUpMeta: document.getElementById('next-up-meta'),
  refreshBtn: document.getElementById('refresh-btn'),
  discoverBtn: document.getElementById('discover-btn'),
  reloadBtn: document.getElementById('reload-btn'),
  table: document.getElementById('topics-table'),
  tbody: document.getElementById('topics-body'),
  emptyState: document.getElementById('empty-state'),
  candidatesSection: document.getElementById('candidates-section'),
  candidatesBody: document.getElementById('candidates-body'),
};

function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.style.display = 'block';
}

function clearError() {
  els.errorBanner.style.display = 'none';
}

function renderTopics(data) {
  const { topics, nextUp, candidates } = data;

  if (nextUp) {
    els.nextUpCard.style.display = 'block';
    els.nextUpCard.dataset.id = nextUp.id;
    els.nextUpTitle.textContent = nextUp.title;
    els.nextUpMeta.textContent = `${ENTRY_POINT_LABELS[nextUp.entryPoint] || nextUp.entryPoint} · covered ${nextUp.timesCovered}x · demand score ${nextUp.demandScore} · click to open your script`;
  }

  renderCandidates(candidates || []);

  if (!topics || topics.length === 0) {
    els.table.style.display = 'none';
    els.emptyState.style.display = 'block';
    els.emptyState.textContent = 'No topics yet.';
    return;
  }

  els.emptyState.style.display = 'none';
  els.table.style.display = 'table';
  els.tbody.innerHTML = '';

  for (const topic of topics) {
    const row = document.createElement('tr');
    const sourceTag = topic.source === 'discovered' ? '<span class="entry-tag source-tag">Discovered</span>' : '';
    row.innerHTML = `
      <td>${escapeHtml(topic.title)}</td>
      <td><span class="entry-tag">${escapeHtml(ENTRY_POINT_LABELS[topic.entryPoint] || topic.entryPoint)}</span> ${angleBadge(topic.angle)} ${sourceTag}</td>
      <td>${topic.timesCovered}</td>
      <td>${topic.demandScore}</td>
      <td><button class="cover-btn" data-id="${escapeHtml(topic.id)}">Mark covered</button></td>
    `;
    els.tbody.appendChild(row);
  }

  els.tbody.querySelectorAll('.cover-btn').forEach(btn => {
    btn.addEventListener('click', () => markCovered(btn.dataset.id));
  });
}

function renderCandidates(candidates) {
  if (!candidates || candidates.length === 0) {
    els.candidatesSection.style.display = 'none';
    els.candidatesBody.innerHTML = '';
    return;
  }

  els.candidatesSection.style.display = 'block';
  els.candidatesBody.innerHTML = candidates.map(candidate => `
    <div class="candidate-card">
      <div class="title">${escapeHtml(candidate.title)}</div>
      <div class="meta-row">
        <span class="entry-tag">${escapeHtml(ENTRY_POINT_LABELS[candidate.entryPoint] || candidate.entryPoint)}</span>
        ${angleBadge(candidate.angle)}
        <span>Demand score: ${candidate.demandScore}</span>
      </div>
      <div class="rationale">${escapeHtml(candidate.rationale)}</div>
      <div class="actions">
        <button class="approve-candidate-btn" data-id="${escapeHtml(candidate.id)}">Approve</button>
        <button class="reject-candidate-btn" data-id="${escapeHtml(candidate.id)}">Reject</button>
      </div>
    </div>
  `).join('');

  els.candidatesBody.querySelectorAll('.approve-candidate-btn').forEach(btn => {
    btn.addEventListener('click', () => decideCandidate(btn.dataset.id, true));
  });
  els.candidatesBody.querySelectorAll('.reject-candidate-btn').forEach(btn => {
    btn.addEventListener('click', () => decideCandidate(btn.dataset.id, false));
  });
}

async function loadTopics() {
  clearError();
  try {
    const res = await fetch('/api/topics');
    if (!res.ok) throw new Error(`Failed to load topics: ${res.status}`);
    const data = await res.json();
    renderTopics(data);
  } catch (err) {
    showError(err.message);
  }
}

async function refreshDemandScores() {
  clearError();
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = 'Scoring…';
  try {
    const res = await fetch('/api/topics/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Refresh failed: ${res.status}`);
    if (data.errors && data.errors.length > 0) {
      showError(`Scored ${data.scoredCount} topics, but hit errors on some: ${data.errors.join('; ')}`);
    }
    renderTopics(data);
  } catch (err) {
    showError(err.message);
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Refresh demand scores';
  }
}

async function discoverTopics() {
  clearError();
  els.discoverBtn.disabled = true;
  els.discoverBtn.textContent = 'Discovering…';
  try {
    const res = await fetch('/api/topics/discover', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Discovery failed: ${res.status}`);
    await loadTopics();
  } catch (err) {
    showError(err.message);
  } finally {
    els.discoverBtn.disabled = false;
    els.discoverBtn.textContent = 'Discover new topics';
  }
}

async function decideCandidate(id, approved) {
  clearError();
  try {
    const res = await fetch('/api/topics/decide-candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approved }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Failed to decide candidate: ${res.status}`);
    renderTopics(data);
  } catch (err) {
    showError(err.message);
  }
}

async function markCovered(id) {
  clearError();
  try {
    const res = await fetch('/api/topics/cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Failed to mark covered: ${res.status}`);
    renderTopics(data);
  } catch (err) {
    showError(err.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

els.refreshBtn.addEventListener('click', refreshDemandScores);
els.discoverBtn.addEventListener('click', discoverTopics);
els.reloadBtn.addEventListener('click', loadTopics);
els.nextUpCard.addEventListener('click', () => {
  if (els.nextUpCard.dataset.id) {
    window.location.href = `slides.html?id=${encodeURIComponent(els.nextUpCard.dataset.id)}`;
  }
});

loadTopics();
