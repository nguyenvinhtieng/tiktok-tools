export function createQuizSpeech({ Context = globalThis.AudioContext || globalThis.webkitAudioContext, request = globalThis.fetch, onState = () => {}, onError = () => {} } = {}) {
  let context, gain, source, controller, finishPlayback, generation = 0, volume = 1, disposed = false;
  const cache = new Map();
  function load(answer, part, background = false) {
    const key = JSON.stringify([answer, part]);
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
          body: JSON.stringify({ answer, part }), signal: entry.controller.signal,
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
      await Promise.all((revealed ? ['answer', 'meaning'] : ['question']).map(part => load(answer, part, true)));
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
  function stop() {
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
        try { buffer = await waitForLoad(load(answer, part), requestController, loadingBudget); }
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
    start, speak, prefetch, stop,
    setVolume(value) { volume = Math.max(0, Math.min(1, Number(value) || 0)); if (gain) gain.gain.value = volume; },
    dispose() { disposed = true; stop(); for (const entry of cache.values()) entry.controller.abort(); cache.clear(); context?.close(); },
  };
}
