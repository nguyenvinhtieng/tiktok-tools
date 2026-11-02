import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, csvCell } from '../server/utils/input.mjs';
test('accepts TikTok video and short links', () => {
  assert.equal(parseInput('https://www.tiktok.com/@user/video/123456789').url, 'https://www.tiktok.com/@user/video/123456789');
  assert.equal(parseInput('https://vm.tiktok.com/abc/').cursor, 0);
  assert.equal(parseInput('https://vt.tiktok.com/abc/', '20').cursor, 20);
});
test('rejects arbitrary hosts, credentials, ports, protocols and bad cursors', () => {
  for (const url of ['https://evil.com/a', 'https://tiktok.com.evil.com/a', 'http://www.tiktok.com/a', 'https://u:p@www.tiktok.com/a', 'https://www.tiktok.com:8080/a', 'https://www.tiktok.com/']) {
    assert.throws(() => parseInput(url));
  }
  for (const cursor of ['-1', 'abc', '1.5', 'Infinity']) assert.throws(() => parseInput('https://vm.tiktok.com/a', cursor));
});
test('CSV escapes quotes, newlines and spreadsheet formulas', () => {
  assert.equal(csvCell('a"b\nc'), '"a""b\nc"');
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
});
