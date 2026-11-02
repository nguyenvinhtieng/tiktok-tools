import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePage, runBulk } from '../utils/bulk.mjs';
const state = (items = []) => ({ items, cursor: 0, hasMore: true, loaded: false });

test('merges unique IDs within and across pages', () => {
  const s = state([{ id: 'a' }]);
  mergePage(s, { comments: [{ id: 'a' }, { id: 'b' }, { id: 'b' }], cursor: 50, hasMore: true });
  mergePage(s, { comments: [{ id: 'b' }, { id: 'c' }], cursor: 100, hasMore: false });
  assert.deepEqual(s.items.map(c => c.id), ['a', 'b', 'c']);
  assert.equal(s.cursor, 100);
  assert.equal(s.hasMore, false);
  assert.equal(s.loaded, true);
});

test('rejects stalled and cycling cursors without applying the bad page', () => {
  const s = state();
  assert.throws(() => mergePage(s, { comments: [{ id: 'bad' }], cursor: 0, hasMore: true }), /cursor/i);
  assert.equal(s.items.length, 0);
  mergePage(s, { comments: [{ id: 'a' }], cursor: 50, hasMore: true });
  mergePage(s, { comments: [{ id: 'b' }], cursor: 100, hasMore: true });
  assert.throws(() => mergePage(s, { comments: [{ id: 'bad' }], cursor: 50, hasMore: true }), /cursor/i);
  assert.equal(s.cursor, 100);
  assert.deepEqual(s.items.map(c => c.id), ['a', 'b']);
});

test('loads all comment pages without requesting replies when disabled', async () => {
  const comments = state(); const calls = [];
  const result = await runBulk({ comments, threads: {}, includeReplies: false, delayMs: 0,
    fetchPage: async q => { calls.push([q.action, q.cursor]); return { comments: [{ id: String(q.cursor), replies: 3 }], cursor: q.cursor + 50, hasMore: q.cursor === 0 }; },
  });
  assert.equal(result, 'complete');
  assert.deepEqual(calls, [['comments', 0], ['comments', 50]]);
});

test('loads existing replies before next comments and paginates each reply thread', async () => {
  const comments = state([{ id: 'a', videoId: 'v', replies: 3 }, { id: 'none', replies: 0 }]);
  const threads = {}; const calls = []; const updates = [];
  await runBulk({ comments, threads, includeReplies: true, delayMs: 0,
    fetchPage: async q => {
      calls.push([q.action, q.commentId, q.cursor]);
      if (q.action === 'comments') return { comments: [{ id: 'b', videoId: 'v', replies: 1 }], cursor: 50, hasMore: false };
      return { comments: [{ id: `${q.commentId}-${q.cursor}` }], cursor: q.cursor + 50, hasMore: q.commentId === 'a' && q.cursor === 0 };
    }, onPage: q => updates.push(q.action),
  });
  assert.deepEqual(calls, [['replies', 'a', 0], ['replies', 'a', 50], ['comments', undefined, 0], ['replies', 'b', 0]]);
  assert.equal(threads.a.items.length, 2);
  assert.equal(threads.b.open, true);
  assert.equal(threads.none, undefined);
  assert.equal(updates.length, 4);
});

test('cancel preserves cursor and resume continues from it', async () => {
  const comments = state(); const controller = new AbortController(); const cursors = [];
  const fetchPage = async q => { cursors.push(q.cursor); return { comments: [{ id: String(q.cursor) }], cursor: q.cursor + 50, hasMore: q.cursor === 0 }; };
  const paused = await runBulk({ comments, threads: {}, includeReplies: false, fetchPage, signal: controller.signal, delayMs: 0, onPage: () => controller.abort() });
  assert.equal(paused, 'paused');
  assert.equal(comments.cursor, 50);
  assert.equal(await runBulk({ comments, threads: {}, includeReplies: false, fetchPage, delayMs: 0 }), 'complete');
  assert.deepEqual(cursors, [0, 50]);
});

test('fetch errors preserve previously loaded pages and remain errors', async () => {
  const comments = state();
  await assert.rejects(runBulk({ comments, threads: {}, delayMs: 0, fetchPage: async q => {
    if (q.cursor) throw new Error('provider unavailable');
    return { comments: [{ id: 'a' }], cursor: 50, hasMore: true };
  } }), /provider unavailable/);
  assert.equal(comments.cursor, 50);
  assert.equal(comments.items.length, 1);
});

test('aborting an in-flight request returns paused without applying a page', async () => {
  const comments = state(); const controller = new AbortController();
  assert.equal(await runBulk({ comments, threads: {}, signal: controller.signal, delayMs: 0, fetchPage: async () => {
    controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  } }), 'paused');
  assert.equal(comments.items.length, 0);
});
