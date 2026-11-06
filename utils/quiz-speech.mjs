import { spokenName, shoutoutBucketMs } from './quiz-shoutout.mjs';

export function createQuizSpeech({ Context = globalThis.AudioContext || globalThis.webkitAudioContext, request = globalThis.fetch, onState = () => {}, onAnnounce = () => {}, onError = () => {} } = {}) {
  let context, gain, source, controller, finishPlayback, generation = 0, volume = 1, disposed = false;
  let announceSource, announceController, announceGeneration = 0;
  const warmedNames = new Set(), warmQueue = [];
  let warmingNames = false, warmTimes = [];
  const cache = new Map();
  // body: { answer, part } for quiz words, or a shout-out part ({ part: 'fastest-name', name } …).
  function load(body, background = false) {
    const key = JSON.stringify(body);
    let entry = cache.get(key);
    if (entry) {
      entry.background ||= background;
      cache.delete(key); cache.set(key, entry);
      return entry.promise;
    }
    while (cache.size >= 24) {
      const oldest = cache.keys().next().value;
      cache.get(oldest).controller.abort(); cache.delete(oldest);
    }
    entry = { controller: new AbortController(), background, pending: true };
    cache.set(key, entry);
    entry.promise = (async () => {
      const timeout = setTimeout(() => entry.controller.abort(), 90000);
      try {
        const response = await request('/api/quiz-speech', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: entry.controller.signal,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error?.data?.message || 'Không lấy được giọng Edge TTS. Hãy thử nghe lại.');
        }
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (entry.controller.signal.aborted || disposed) throw new Error('Đã hủy tải giọng đọc.');
        entry.pending = false;
        return buffer;
      } catch (error) {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      } finally { clearTimeout(timeout); }
    })();
    return entry.promise;
  }
  async function prefetch(answer, revealed = false) {
    if (!context || disposed) return false;
    try {
      await Promise.all((revealed ? ['answer', 'meaning'] : ['question']).map(part => load({ answer, part }, true)));
      return true;
    } catch { return false; }
  }
  function cancelForegroundLoads() {
    for (const [key, entry] of cache) {
      if (entry.pending && !entry.background) { entry.controller.abort(); cache.delete(key); }
    }
  }
  function waitForLoad(promise, requestController, budget) {
    const { signal } = requestController;
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new Error('Đã hủy tải giọng đọc.')); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Tải giọng đọc quá 10 giây. Hãy thử nghe lại.'));
        requestController.abort();
      }, Math.max(0, budget));
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
  function stopAnnounce() {
    if (!announceController && !announceSource) return;
    announceGeneration++;
    announceController?.abort(); announceController = undefined;
    try { announceSource?.stop(); } catch {}
    announceSource?.disconnect(); announceSource = undefined;
    onAnnounce(false);
  }
  // Fixed clips are fetched now; the server also starts generating all whole-second tails.
  async function prefetchShoutout() {
    if (!context || disposed) return false;
    try { await Promise.all([load({ part: 'fastest-intro' }, true), load({ part: 'fastest-anon' }, true)]); return true; } catch { return false; }
  }
  // Anyone who comments may be the next fastest answer: have the server generate their name
  // in the background (newest first, ≤20/min) so the shout-out finds it on disk.
  function warmName(raw) {
    const name = spokenName(raw);
    if (!name || disposed || warmedNames.has(name)) return;
    if (warmedNames.size > 1000) warmedNames.clear();
    warmedNames.add(name); warmQueue.push(name);
    if (warmQueue.length > 20) warmedNames.delete(warmQueue.shift());
    pumpWarm();
  }
  async function pumpWarm() {
    if (warmingNames) return;
    warmingNames = true;
    try {
      while (warmQueue.length && !disposed) {
        warmTimes = warmTimes.filter(time => time > Date.now() - 60000);
        if (warmTimes.length >= 20) { await new Promise(resolve => setTimeout(resolve, 60000 - (Date.now() - warmTimes[0]))); continue; }
        const name = warmQueue.pop();
        warmTimes.push(Date.now());
        try {
          const response = await request('/api/quiz-speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part: 'fastest-name', name }) });
          await response.arrayBuffer?.();
          if (!response.ok) warmedNames.delete(name);
        } catch { warmedNames.delete(name); }
      }
    } finally { warmingNames = false; }
  }
  // Resolves with the value, or rejects after `ms` without cancelling the load (it keeps caching).
  function within(promise, signal, ms) {
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new Error('Đã dừng lời khen.')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, Math.max(0, ms));
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
  function playAnnounce(buffer, signal) {
    return new Promise((resolve, reject) => {
      const playing = context.createBufferSource(); playing.buffer = buffer; playing.connect(gain); announceSource = playing;
      const cleanup = () => { clearTimeout(watchdog); signal.removeEventListener('abort', abort); playing.onended = null; };
      const abort = () => { cleanup(); try { playing.stop(); } catch {} reject(new Error('Đã dừng lời khen.')); };
      const watchdog = setTimeout(abort, Math.min(20000, (buffer.duration || 10) * 1000 + 3000));
      signal.addEventListener('abort', abort, { once: true });
      playing.onended = () => { cleanup(); playing.disconnect(); if (announceSource === playing) announceSource = undefined; resolve(); };
      try { playing.start(); } catch (error) { cleanup(); reject(error); }
    });
  }
  // "Tuyệt vời!" plays at once; the name gets until the intro ends (+nameWait) or "Có bạn" is used.
  async function announce(name, ms, { delay = 0, introWait = 2500, nameWait = 600, tailWait = 2500 } = {}) {
    if (!context || disposed) return false;
    stopAnnounce();
    const current = ++announceGeneration, requestController = new AbortController();
    announceController = requestController;
    const { signal } = requestController, spoken = spokenName(name);
    const intro = load({ part: 'fastest-intro' }, true), anon = load({ part: 'fastest-anon' }, true);
    const named = spoken ? load({ part: 'fastest-name', name: spoken }, true) : anon;
    const tail = load({ part: 'fastest-time', ms: shoutoutBucketMs(ms) }, true);
    [intro, anon, named, tail].forEach(promise => promise.catch(() => {}));
    onAnnounce(true);
    try {
      if (context.state !== 'running') await context.resume();
      if (delay) await within(new Promise(resolve => setTimeout(resolve, delay)), signal, delay + 50);
      await playAnnounce(await within(intro, signal, introWait), signal);
      let nameBuffer;
      try { nameBuffer = await within(named, signal, nameWait); }
      catch (error) { if (signal.aborted) throw error; nameBuffer = await within(anon, signal, 300); }
      const tailBuffer = await within(tail, signal, tailWait);
      if (current !== announceGeneration) return false;
      await playAnnounce(nameBuffer, signal);
      await playAnnounce(tailBuffer, signal);
      return current === announceGeneration;
    } catch { return false; }
    finally {
      if (current === announceGeneration) {
        announceSource?.disconnect(); announceSource = undefined; announceController = undefined; onAnnounce(false);
      }
    }
  }
  function stop() {
    stopAnnounce();
    generation++;
    controller?.abort(); controller = undefined;
    cancelForegroundLoads();
    finishPlayback?.(); finishPlayback = undefined;
    try { source?.stop(); } catch {}
    source?.disconnect(); source = undefined;
    onState(false);
  }
  async function start() {
    if (disposed) throw new Error('Giọng đọc đã đóng.');
    if (!Context) throw new Error('Trình duyệt không hỗ trợ phát giọng đọc.');
    if (!context) { context = new Context(); gain = context.createGain(); gain.gain.value = volume; gain.connect(context.destination); }
    await context.resume();
  }
  async function speak(answer, revealed = false) {
    stop();
    const current = generation;
    const requestController = new AbortController();
    controller = requestController;
    const signal = requestController.signal;
    let loadingBudget = 10000;
    onState(true);
    try {
      if (!context || context.state !== 'running') await start();
      for (const part of revealed ? ['answer', 'meaning'] : ['question']) {
        if (current !== generation || signal.aborted) return false;
        const loadingAt = Date.now();
        let buffer;
        try { buffer = await waitForLoad(load({ answer, part }), requestController, loadingBudget); }
        finally { loadingBudget -= Math.max(0, Date.now() - loadingAt); }
        if (current !== generation || signal.aborted) return false;
        await new Promise((resolve, reject) => {
          const playing = context.createBufferSource(); playing.buffer = buffer; playing.connect(gain); source = playing;
          const cleanup = () => {
            clearTimeout(watchdog); signal.removeEventListener('abort', abort); playing.onended = null;
            if (finishPlayback === complete) finishPlayback = undefined;
          };
          const complete = () => { cleanup(); resolve(); };
          const abort = () => { cleanup(); try { playing.stop(); } catch {} reject(new Error('Đã hết thời gian phát giọng đọc.')); };
          const watchdog = setTimeout(abort, Math.min(60000, (buffer.duration || 30) * 1000 + 5000));
          signal.addEventListener('abort', abort, { once: true });
          finishPlayback = complete;
          playing.onended = complete;
          try { playing.start(); } catch (error) { cleanup(); reject(error); }
        });
        if (current !== generation) return false;
        source?.disconnect(); source = undefined;
      }
      return current === generation && !signal.aborted;
    } catch (error) {
      if (current === generation) onError(error.message || 'Không phát được giọng đọc.');
      return false;
    } finally {
      if (current === generation) {
        if (signal.aborted) cancelForegroundLoads();
        source?.disconnect(); source = undefined; controller = undefined; onState(false);
      }
    }
  }
  return {
    start, speak, prefetch, stop, announce, prefetchShoutout, stopAnnounce, warmName,
    setVolume(value) { volume = Math.max(0, Math.min(1, Number(value) || 0)); if (gain) gain.gain.value = volume; },
    dispose() { disposed = true; stop(); for (const entry of cache.values()) entry.controller.abort(); cache.clear(); context?.close(); },
  };
}
