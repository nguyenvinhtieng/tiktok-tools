export function mergePage(state, result) {
  const next = Number(result.cursor ?? 0);
  const current = Number(state.cursor ?? 0);
  const seenCursors = state.seenCursors || new Set();
  if (result.hasMore && (next === current || seenCursors.has(next))) {
    throw new Error('API trả cursor lặp. Đã dừng để tránh tải vô hạn.');
  }
  const seen = new Set(state.items.map(item => item.id));
  const additions = [];
  for (const item of result.comments || []) {
    if (!seen.has(item.id)) { seen.add(item.id); additions.push(item); }
  }
  state.items.push(...additions);
  seenCursors.add(current);
  state.seenCursors = seenCursors;
  state.cursor = next;
  state.hasMore = Boolean(result.hasMore);
  state.loaded = true;
}

function pause(ms, signal) {
  if (!ms || signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function runBulk({ comments, threads, includeReplies = false, fetchPage, onPage = () => {}, signal, delayMs = 500 }) {
  let requested = false;
  async function page(action, state, parent) {
    if (requested) await pause(delayMs, signal);
    if (signal?.aborted) return false;
    requested = true;
    const result = await fetchPage({ action, cursor: state.cursor, ...(parent ? { commentId: parent.id, videoId: parent.videoId } : {}), signal });
    if (signal?.aborted) return false;
    mergePage(state, result);
    onPage({ action, parent, state });
    return true;
  }
  async function replies() {
    if (!includeReplies) return true;
    for (const parent of comments.items) {
      if (signal?.aborted) return false;
      if (!(parent.replies > 0)) continue;
      threads[parent.id] ||= { items: [], cursor: 0, hasMore: true, loaded: false, open: true };
      const thread = threads[parent.id];
      thread.open = true;
      while (!thread.loaded || thread.hasMore) {
        if (!await page('replies', thread, parent)) return false;
      }
    }
    return true;
  }
  try {
    if (!await replies()) return 'paused';
    while (!comments.loaded || comments.hasMore) {
      if (!await page('comments', comments)) return 'paused';
      if (!await replies()) return 'paused';
    }
    return signal?.aborted ? 'paused' : 'complete';
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') return 'paused';
    throw error;
  }
}
