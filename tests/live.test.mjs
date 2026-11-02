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
