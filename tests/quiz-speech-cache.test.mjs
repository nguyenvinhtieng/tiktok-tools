import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpeechCache } from '../server/utils/quiz-speech.mjs';

const audio = Buffer.from('ID3mock-audio');
const success = () => audio;
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'quiz-speech-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('speech cache persists audio and serves it after restart without generating again', async t => {
  const path = await directory(t);
  let calls = 0;
  const get = createSpeechCache({ directory: path, synthesize: async () => { calls++; return success(); } });
  assert.deepEqual(await get('Xin chào', 'vi'), audio);
  const restored = createSpeechCache({ directory: path, synthesize: async () => { throw new Error('Cache hit must not call provider'); } });
  assert.deepEqual(await restored('Xin chào', 'vi'), audio);
  assert.equal(calls, 1);
  assert.equal((await readdir(path)).filter(name => name.endsWith('.mp3')).length, 1);
});

test('audio filenames identify the word and part with a bounded safe name', async t => {
  const path = await directory(t);
  const get = createSpeechCache({ directory: path, synthesize: success });
  await get('Từ tiếng Anh nào có nghĩa là: quả táo?', 'vi', { answer: 'Apple', part: 'question' });
  await get('apple', 'en', { answer: '../../Áp ple?'.repeat(20), part: 'answer' });
  const names = await readdir(path);
  assert.ok(names.some(name => /^apple-question-[a-f0-9]{20}\.mp3$/.test(name)));
  assert.ok(names.every(name => /^[a-z0-9-]+\.mp3$/.test(name) && name.length <= 75));
});

test('legacy hash files are reused and renamed without contacting the provider', async t => {
  const path = await directory(t);
  const key = createHash('sha256').update(JSON.stringify({ version: 1, provider: 'edge-tts-v1', language: 'en', text: 'apple', voice: 'en-US-JennyNeural', rate: '+0%' })).digest('hex');
  await writeFile(join(path, `${key}.mp3`), audio);
  const get = createSpeechCache({ directory: path, synthesize: () => { throw new Error('Must reuse legacy audio'); } });
  assert.deepEqual(await get('apple', 'en', { answer: 'apple', part: 'answer' }), audio);
  assert.deepEqual(await readdir(path), [`apple-answer-${key.slice(0, 20)}.mp3`]);
});

test('simultaneous requests for one utterance generate audio once', async t => {
  const path = await directory(t);
  let calls = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const get = createSpeechCache({ directory: path, synthesize: async () => { calls++; await blocked; return success(); } });
  const requests = [get('apple', 'en'), get('apple', 'en'), get('apple', 'en')];
  release();
  for (const result of await Promise.all(requests)) assert.deepEqual(result, audio);
  assert.equal(calls, 1);
});

test('cache separates text, language, voice, provider and speaking speed', async t => {
  const path = await directory(t);
  let calls = 0;
  const options = { directory: path, synthesize: async () => { calls++; return success(); } };
  const get = createSpeechCache(options);
  await get('apple', 'en');
  await get('pear', 'en');
  await get('apple', 'vi');
  await createSpeechCache({ ...options, voices: { vi: 'vi-VN-HoaiMyNeural', en: 'en-GB-SoniaNeural' } })('apple', 'en');
  await createSpeechCache({ ...options, provider: 'other-provider' })('apple', 'en');
  await createSpeechCache({ ...options, speed: '-10%' })('apple', 'en');
  assert.equal(calls, 6);
  assert.equal((await readdir(path)).filter(name => name.endsWith('.mp3')).length, 6);
});

test('provider failure leaves no cached file and a later request can retry', async t => {
  const path = await directory(t);
  let calls = 0;
  const get = createSpeechCache({ directory: path, synthesize: async () => { if (++calls === 1) throw new Error('Provider unavailable'); return success(); } });
  await assert.rejects(get('apple', 'en'));
  assert.deepEqual(await readdir(path), []);
  assert.deepEqual(await get('apple', 'en'), audio);
  assert.equal(calls, 2);
});

test('uncached requests without synthesis adapter fail with an actionable service status', async t => {
  const get = createSpeechCache({ directory: await directory(t) });
  await assert.rejects(get('apple', 'en'), { statusCode: 503 });
});

test('invalid text or language is rejected before provider access', async t => {
  const get = createSpeechCache({ directory: await directory(t), synthesize: async () => { throw new Error('Must not call provider'); } });
  for (const [text, language] of [['', 'en'], ['  ', 'vi'], [null, 'en'], ['apple', 'fr'], ['a'.repeat(501), 'en']]) {
    await assert.rejects(get(text, language), { statusCode: 400 });
  }
});

test('malformed MP3 and oversized provider audio are never persisted', async t => {
  const path = await directory(t);
  for (const payload of [Buffer.from('broken'), Buffer.alloc(10000001), 'not-a-buffer']) {
    const get = createSpeechCache({ directory: path, synthesize: async () => payload });
    await assert.rejects(get('apple', 'en'));
    assert.deepEqual(await readdir(path), []);
  }
});
