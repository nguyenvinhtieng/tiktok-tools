import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenName, shoutoutSeconds, shoutoutText, shoutoutTail, shoutoutBucketMs, SHOUTOUT_TAIL_BUCKETS, validShoutoutMs, createBrowserShoutout } from '../utils/quiz-shoutout.mjs';
import { createQuizSpeech } from '../utils/quiz-speech.mjs';

test('spoken names drop emoji and separators but keep Vietnamese letters', () => {
  assert.equal(spokenName('🔥Ngọc_Ánh.99🔥'), 'Ngọc Ánh 99');
  assert.equal(spokenName('  ✨✨  '), '');
  assert.equal(Array.from(spokenName('a'.repeat(80))).length, 40);
});

test('popup shows tenths while the voice uses one of 61 pre-generated whole-second tails', () => {
  assert.equal(shoutoutSeconds(2440), '2,4');
  assert.equal(shoutoutSeconds(3000), '3');
  assert.equal(shoutoutSeconds(20), '0,1');
  assert.equal(shoutoutText('ABC', 1520), 'Tuyệt vời! ABC trả lời đúng nhanh nhất, chỉ trong 2 giây!');
  assert.equal(shoutoutText('🎉', 400), 'Tuyệt vời! Có bạn trả lời đúng nhanh nhất, chưa tới 1 giây!');
  assert.equal(shoutoutBucketMs(90000), 60000);
  const tails = new Set(SHOUTOUT_TAIL_BUCKETS.map(shoutoutTail));
  assert.equal(tails.size, 61);
  for (let ms = 0; ms <= 600000; ms += 137) assert.ok(tails.has(shoutoutTail(ms)));
  assert.equal(validShoutoutMs(-1), false); assert.equal(validShoutoutMs(700000), false); assert.equal(validShoutoutMs(1200), true);
});

test('browser shout-out prefers a Vietnamese voice and reports speaking state', () => {
  const spoken = [], states = [];
  const synth = { getVoices: () => [{ lang: 'en-US', localService: true }, { lang: 'vi-VN', name: 'Linh', localService: true }],
    cancel() {}, speak(u) { spoken.push(u); } };
  class Utterance { constructor(text) { this.text = text; } }
  const shout = createBrowserShoutout({ synth, Utterance, onState: s => states.push(s) });
  assert.equal(shout.hasVietnamese(), true);
  shout.speak('xin chào', .5);
  assert.equal(spoken[0].voice.name, 'Linh'); assert.equal(spoken[0].volume, .5);
  spoken[0].onend(); assert.deepEqual(states, [true, false]);
});

function speechFixture(request) {
  const sources = [], announce = [];
  class Context {
    destination = {}; state = 'running';
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() { queueMicrotask(() => source.onended?.()); }, stop() { source.stopped = true; } };
      sources.push(source); return source;
    }
    async decodeAudioData(buffer) { return { duration: .1, part: buffer.part }; }
    async resume() {} async close() {}
  }
  const bodies = [];
  const speech = createQuizSpeech({ Context, onAnnounce: s => announce.push(s), request: async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    await request?.(body);
    const buffer = new ArrayBuffer(8); buffer.part = body.name || body.part;
    return { ok: true, arrayBuffer: async () => buffer };
  } });
  return { speech, sources, announce, bodies, played: () => sources.map(s => s.buffer.part) };
}

test('announce plays intro, cleaned name and whole-second tail in order', async () => {
  const f = speechFixture();
  await f.speech.start();
  assert.equal(await f.speech.prefetchShoutout(), true);
  assert.equal(await f.speech.announce('🔥ABC_x', 2440.6), true);
  assert.deepEqual(f.played(), ['fastest-intro', 'ABC x', 'fastest-time']);
  assert.ok(f.bodies.some(b => b.part === 'fastest-time' && b.ms === 2000));
  assert.deepEqual(f.announce, [true, false]);
  f.speech.dispose();
});

test('a name that is not ready after the intro falls back to the generic clip', async () => {
  const f = speechFixture(body => body.part === 'fastest-name' ? new Promise(r => setTimeout(r, 200)) : undefined);
  await f.speech.start();
  assert.equal(await f.speech.announce('Slow', 1000, { nameWait: 20 }), true);
  assert.deepEqual(f.played(), ['fastest-intro', 'fastest-anon', 'fastest-time']);
  f.speech.dispose();
});

test('reading the answer cuts off a pending shout-out', async () => {
  let release;
  const f = speechFixture(body => body.part === 'fastest-time' ? new Promise(r => { release = r; }) : undefined);
  await f.speech.start();
  const pending = f.speech.announce('ABC', 1000);
  await new Promise(r => setTimeout(r, 10));
  const answer = f.speech.speak('apple', true);
  release();
  assert.equal(await pending, false);
  assert.equal(await answer, true);
  assert.equal(f.announce.at(-1), false);
  f.speech.dispose();
});

test('commenters are warmed once each, newest first, without decoding audio', async () => {
  let release;
  const f = speechFixture(body => body.part === 'fastest-name' && body.name === 'A' ? new Promise(r => { release = r; }) : undefined);
  for (const name of ['A', 'B', 'C', 'B', '✨']) f.speech.warmName(name);
  await new Promise(r => setTimeout(r, 5));
  release();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(f.bodies.map(b => b.name), ['A', 'C', 'B']);
  assert.equal(f.sources.length, 0);
  f.speech.dispose();
});
