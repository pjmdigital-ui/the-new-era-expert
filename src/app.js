const ENTRY_POINT_LABELS = {
  'problem-is-real': 'Problem is real',
  'alternatives-fail': 'Alternatives fail',
  'category-exists': 'Category exists',
  'credible-and-different': 'Credible & different',
  'i-am-capable': 'I am capable',
  'act-now': 'Act now',
  'proof-premise-7-8': 'Proof (Premise 7/8)',
};

const els = {
  errorBanner: document.getElementById('error-banner'),
  nextUpCard: document.getElementById('next-up-card'),
  nextUpTitle: document.getElementById('next-up-title'),
  nextUpMeta: document.getElementById('next-up-meta'),
  refreshBtn: document.getElementById('refresh-btn'),
  reloadBtn: document.getElementById('reload-btn'),
  table: document.getElementById('topics-table'),
  tbody: document.getElementById('topics-body'),
  emptyState: document.getElementById('empty-state'),
};

function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.style.display = 'block';
}

function clearError() {
  els.errorBanner.style.display = 'none';
}

function renderTopics(data) {
  const { topics, nextUp } = data;

  if (nextUp) {
    els.nextUpCard.style.display = 'block';
    els.nextUpTitle.textContent = nextUp.title;
    els.nextUpMeta.textContent = `${ENTRY_POINT_LABELS[nextUp.entryPoint] || nextUp.entryPoint} · covered ${nextUp.timesCovered}x · demand score ${nextUp.demandScore}`;
  }

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
    row.innerHTML = `
      <td>${escapeHtml(topic.title)}</td>
      <td><span class="entry-tag">${escapeHtml(ENTRY_POINT_LABELS[topic.entryPoint] || topic.entryPoint)}</span></td>
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
els.reloadBtn.addEventListener('click', loadTopics);

loadTopics();
