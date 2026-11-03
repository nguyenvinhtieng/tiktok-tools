import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuizSpeech } from '../utils/quiz-speech.mjs';

function fixture(options = {}) {
  const sources = [], requests = [], errors = [], states = [];
  let resumed = 0, closed = 0;
  class Context {
    destination = {};
    state = 'suspended';
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, stopped: false,
        start() { queueMicrotask(() => source.onended?.()); },
        stop() { source.stopped = true; source.onended?.(); } };
      sources.push(source); return source;
    }
    async decodeAudioData() { return { duration: .1 }; }
    async resume() { resumed++; this.state = 'running'; }
    async close() { closed++; this.state = 'closed'; }
  }
  const speech = createQuizSpeech({ Context,
    request: async (url, init) => { requests.push({ url, ...init }); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    onState: state => states.push(state), onError: error => errors.push(error), ...options });
  return { speech, sources, requests, errors, states, counts: () => ({ resumed, closed }) };
}

test('speech waits for user start and an explicit utterance before requesting audio', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  await f.speech.start();
  assert.equal(f.counts().resumed, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(await f.speech.speak('apple'), true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/quiz-speech');
  assert.equal(f.requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(f.requests[0].body), { answer: 'apple', part: 'question' });
  assert.equal(f.sources.length, 1);
  f.speech.dispose();
});

test('revealed answer requests English pronunciation then Vietnamese meaning sequentially', async () => {
  const f = fixture();
  await f.speech.start();
  assert.equal(await f.speech.speak('apple', true), true);
  assert.deepEqual(f.requests.map(item => JSON.parse(item.body)), [
    { answer: 'apple', part: 'answer' }, { answer: 'apple', part: 'meaning' },
  ]);
  assert.equal(f.sources.length, 2);
  f.speech.dispose();
});

test('prefetch prepares all answer parts silently and playback reuses decoded audio', async () => {
  const f = fixture();
  await f.speech.start();
  assert.equal(await f.speech.prefetch('apple', true), true);
  assert.deepEqual(f.requests.map(item => JSON.parse(item.body).part), ['answer', 'meaning']);
  assert.deepEqual(f.states, []);
  assert.equal(f.sources.length, 0);
  assert.equal(await f.speech.speak('apple', true), true);
  assert.equal(f.requests.length, 2);
  assert.equal(f.sources.length, 2);
  f.speech.dispose();
});

test('playback shares an in-flight prefetch and stopping prevents stale playback', async () => {
  let respond, calls = 0;
  const f = fixture({ request: () => { calls++; return new Promise(resolve => { respond = resolve; }); } });
  await f.speech.start();
  const prefetched = f.speech.prefetch('apple');
  const speaking = f.speech.speak('apple');
  await Promise.resolve();
  f.speech.stop();
  respond({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  assert.equal(await prefetched, true);
  assert.equal(await speaking, false);
  assert.equal(calls, 1);
  assert.equal(f.sources.length, 0);
  f.speech.dispose();
});

test('failed prefetch is silent and can be retried during playback', async () => {
  let calls = 0;
  const f = fixture({ request: async () => ++calls === 1
    ? { ok: false, json: async () => ({}) }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } });
  await f.speech.start();
  assert.equal(await f.speech.prefetch('apple'), false);
  assert.deepEqual(f.errors, []);
  assert.equal(await f.speech.speak('apple'), true);
  assert.equal(calls, 2);
  f.speech.dispose();
});

test('foreground loading stops after ten seconds while background audio stays reusable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let respond;
  const f = fixture({ request: () => new Promise(resolve => { respond = resolve; }) });
  await f.speech.start();
  const preparation = f.speech.prefetch('apple');
  const speaking = f.speech.speak('apple');
  t.mock.timers.tick(10000);
  assert.equal(await speaking, false);
  assert.equal(f.states.at(-1), false);
  assert.match(f.errors[0], /10 giây/);
  respond({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  assert.equal(await preparation, true);
  assert.equal(f.sources.length, 0);
  assert.equal(await f.speech.speak('apple'), true);
  assert.equal(f.sources.length, 1);
  f.speech.dispose();
});

test('replacement speech promptly settles a shared pending read even if fetch ignores abort', async () => {
  let respond;
  const f = fixture({ request: (url, init) => JSON.parse(init.body).answer === 'apple'
    ? new Promise(resolve => { respond = resolve; })
    : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  await f.speech.start();
  const preparation = f.speech.prefetch('apple');
  const first = f.speech.speak('apple');
  const second = f.speech.speak('pear');
  assert.equal(await first, false);
  assert.equal(await second, true);
  respond({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await preparation;
  assert.equal(f.sources.length, 1);
  assert.deepEqual(f.errors, []);
  f.speech.dispose();
});

test('answer and meaning share ten seconds of loading budget excluding playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const pending = [], sources = [];
  class Context {
    destination = {}; state = 'running';
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() {}, stop() {} };
      sources.push(source); return source;
    }
    async decodeAudioData() { return { duration: 30 }; }
    async resume() {}
    async close() {}
  }
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const f = fixture({ Context, request: () => new Promise(resolve => pending.push(resolve)) });
  await f.speech.start();
  const speaking = f.speech.speak('apple', true);
  t.mock.timers.tick(6000);
  pending.shift()({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await flush();
  assert.equal(sources.length, 1);
  t.mock.timers.tick(20000);
  sources[0].onended();
  await flush();
  assert.equal(pending.length, 1);
  t.mock.timers.tick(3999);
  assert.equal(f.states.at(-1), true);
  t.mock.timers.tick(1);
  assert.equal(await speaking, false);
  assert.equal(f.states.at(-1), false);
  pending.shift()({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await flush();
  assert.equal(sources.length, 1);
  f.speech.dispose();
});

test('prefetch cache is bounded and disposal cancels pending preparation', async () => {
  const f = fixture();
  await f.speech.start();
  for (let i = 0; i < 25; i++) await f.speech.prefetch(`word-${i}`);
  await f.speech.speak('word-0');
  assert.equal(f.requests.length, 26);
  f.speech.dispose();
  let signal;
  const pending = fixture({ request: (url, init) => {
    signal = init.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  await pending.speech.start();
  const preparation = pending.speech.prefetch('apple');
  pending.speech.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(await preparation, false);
  assert.deepEqual(pending.errors, []);
});

test('stopping a pending request aborts it and prevents stale playback or error reporting', async () => {
  let respond, signal;
  const f = fixture({ request: (url, init) => { signal = init.signal; return new Promise(resolve => { respond = resolve; }); } });
  await f.speech.start();
  const speaking = f.speech.speak('apple');
  await Promise.resolve();
  f.speech.stop();
  assert.equal(signal.aborted, true);
  respond({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  assert.equal(await speaking, false);
  assert.equal(f.sources.length, 0);
  assert.deepEqual(f.errors, []);
  f.speech.dispose();
});

test('provider errors are reported once and return false without playback', async () => {
  const f = fixture({ request: async () => ({ ok: false, status: 503, json: async () => ({ statusMessage: 'Chưa cấu hình giọng đọc' }) }) });
  await f.speech.start();
  assert.equal(await f.speech.speak('apple'), false);
  assert.equal(f.errors.length, 1);
  assert.equal(f.sources.length, 0);
  f.speech.dispose();
});

test('stop releases a playing source and dispose closes the audio context', async () => {
  let source, closed = false;
  class Context {
    destination = {}; state = 'running';
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBufferSource() { source = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; this.onended?.(); } }; return source; }
    async decodeAudioData() { return { duration: .1 }; }
    async resume() {}
    async close() { closed = true; this.state = 'closed'; }
  }
  const f = fixture({ Context });
  await f.speech.start();
  const speaking = f.speech.speak('apple');
  while (!source) await Promise.resolve();
  f.speech.stop();
  assert.equal(await speaking, false);
  assert.equal(source.stopped, true);
  f.speech.setVolume(.4);
  f.speech.dispose();
  assert.equal(closed, true);
});

test('a stale ended callback cannot interrupt replacement playback', async () => {
  const sources = [];
  class Context {
    destination = {}; state = 'running';
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
    async decodeAudioData() { return { duration: .1 }; }
    async resume() {}
    async close() {}
  }
  const f = fixture({ Context });
  await f.speech.start();
  const first = f.speech.speak('apple');
  while (sources.length < 1) await Promise.resolve();
  const oldEnded = sources[0].onended;
  const second = f.speech.speak('pear');
  while (sources.length < 2) await Promise.resolve();
  oldEnded();
  assert.equal(sources[1].stopped, undefined);
  f.speech.stop();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(sources[1].stopped, true);
  f.speech.dispose();
});

test('question speech holds the timer and only extends its own current round', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const quiz = await import('../utils/quiz.mjs');
  const { WORDS } = await import('../utils/quiz-words.mjs');
  const source = await readFile(new URL('../components/EnglishQuiz.vue', import.meta.url), 'utf8');
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  let clock = 1000, tick;
  const pending = [];
  class Clock extends Date { static now() { return clock; } }
  const state = runInNewContext(script + `;
    speech={speak:()=>new Promise(resolve=>pending.push(resolve)),stop(){}};
    speechEnabled.value=true;
    startRound(game.value,{answer:'apple',band:'A1'},1000,15);
    running.value=true;
    ({readRound,game,remainingMs,questionReadAt,resultsOpen});`, {
    ...quiz, WORDS, pending, Date: Clock,
    ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    watch() {}, onMounted: fn => fn(), onBeforeUnmount() {},
    document: { addEventListener() {} }, setInterval: fn => { tick = fn; },
  });
  const reading = state.readRound();
  clock = 21000; tick();
  assert.equal(state.remainingMs.value, 15000);
  assert.equal(state.resultsOpen.value, false);
  assert.equal(state.game.value.round.deadline, 16000);
  pending.shift()(true); await reading;
  assert.equal(state.game.value.round.deadline, 36000);
  assert.equal(state.questionReadAt.value, 0);
  const staleReading = state.readRound();
  quiz.startRound(state.game.value, { answer: 'pear', band: 'A1' }, clock, 15);
  const replacementDeadline = state.game.value.round.deadline;
  clock = 31000;
  pending.shift()(true); await staleReading;
  assert.equal(state.game.value.round.deadline, replacementDeadline);
});
