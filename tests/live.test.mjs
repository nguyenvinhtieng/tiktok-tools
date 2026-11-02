import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveUrl, serializeLiveEvent } from '../server/utils/live.mjs';

test('accepts public LIVE links and strips tracking query', () => {
  assert.equal(parseLiveUrl(' https://www.tiktok.com/@some.user/live?foo=bar '), 'some.user');
});
test('rejects non-LIVE links and arbitrary destinations', () => {
  for (const url of ['https://evil.com/@user/live', 'https://www.tiktok.com.evil.com/@user/live', 'http://www.tiktok.com/@user/live', 'https://u:p@www.tiktok.com/@user/live', 'https://www.tiktok.com:444/@user/live', 'https://www.tiktok.com/@user/video/123', 'https://www.tiktok.com/@/live']) assert.throws(() => parseLiveUrl(url));
});
test('keeps nested sender and gift fields, preserves bigint IDs as strings', () => {
  const data = { user: { id: 12345678901234567890n, nickname: 'A', extra: { badge: 2 } }, gift: { id: 3, repeatEnd: false }, unknown: [1, 2] };
  const event = JSON.parse(serializeLiveEvent('gift', data));
  assert.equal(event.type, 'gift');
  assert.equal(event.data.user.id, '12345678901234567890');
  assert.deepEqual(event.data.user.extra, { badge: 2 });
  assert.deepEqual(event.data.unknown, [1, 2]);
  assert.equal(event.data.gift.repeatEnd, false);
});

test('normalizes native chat content for display and quiz scoring without losing payload fields', async () => {
  const { createGame, startRound, acceptChat } = await import('../utils/quiz.mjs');
  const data = { user: { id: 'viewer', nickname: 'An' }, content: 'apple', common: { msgId: 'chat-1' } };
  const event = JSON.parse(serializeLiveEvent('chat', data));
  assert.equal(event.data.comment, 'apple');
  assert.equal(event.data.content, 'apple');
  assert.deepEqual(event.data.common, data.common);
  assert.equal(data.comment, undefined);
  const game = createGame();
  startRound(game, { answer: 'apple', band: 'A1' }, 1000, 30);
  assert.equal(acceptChat(game, event.data, 1001), 10);
});
test('preserves legacy chat comments and leaves other events unchanged', () => {
  assert.equal(JSON.parse(serializeLiveEvent('chat', { comment: 'hello', content: 'other' })).data.comment, 'hello');
  assert.equal(JSON.parse(serializeLiveEvent('chat', { comment: '', content: 'hello' })).data.comment, 'hello');
  assert.deepEqual(JSON.parse(serializeLiveEvent('gift', { content: 'gift' })).data, { content: 'gift' });
});
