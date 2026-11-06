import { WORDS } from './quiz-words.mjs';
const words = new Map(WORDS.map(word => [word.answer, word]));

export function createBrowserQuizSpeech({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, onState = () => {}, onError = () => {} } = {}) {
  let generation = 0, volume = 1, finish, disposed = false;
  function stop() {
    generation++;
    finish?.(false); finish = undefined;
    synth?.cancel(); onState(false);
  }
  async function start() {
    if (disposed) throw new Error('Giọng đọc đã đóng.');
    if (!synth || !Utterance) throw new Error('Trình duyệt không hỗ trợ giọng đọc.');
    synth.resume();
  }
  async function speak(answer, revealed = false) {
    stop();
    const current = generation;
    onState(true);
    try {
      // Keep speak() in the user gesture when possible.
      if (disposed || !synth || !Utterance) await start();
      const word = words.get(answer);
      if (!word) throw new Error('Không tìm thấy từ để đọc.');
      const parts = revealed ? [[word.answer, 'en-US'], [word.vi, 'vi-VN']] : [[`Từ tiếng Anh nào có nghĩa là: ${word.vi}?`, 'vi-VN']];
      for (const [text, lang] of parts) {
        if (current !== generation) return false;
        const completed = await new Promise((resolve, reject) => {
          const utterance = new Utterance(text);
          const voices = synth.getVoices();
          const matches = voices.filter(voice => voice.lang.slice(0, 2).toLowerCase() === lang.slice(0, 2));
          const selected = matches.find(voice => voice.localService) || matches[0];
          utterance.lang = selected?.lang || lang;
          if (selected) utterance.voice = selected;
          utterance.volume = volume;
          const done = value => { clearTimeout(timer); utterance.onend = utterance.onerror = null; if (finish === done) finish = undefined; resolve(value); };
          const timer = setTimeout(() => { done(false); if (current === generation) { synth.cancel(); onError('Giọng trình duyệt không phản hồi. Hãy thử nghe lại.'); } }, 60000);
          finish = done;
          utterance.onend = () => done(true);
          utterance.onerror = event => { done(false); if (current === generation) onError(`Không phát được giọng trình duyệt (${event.error || 'lỗi phát âm thanh'}).`); };
          try { synth.resume(); synth.speak(utterance); } catch (error) { done(false); reject(error); }
        });
        if (!completed || current !== generation) return false;
      }
      return true;
    } catch (error) {
      if (current === generation) onError(error.message);
      return false;
    } finally { if (current === generation) onState(false); }
  }
  return {
    start, speak, stop,
    prefetch() {}, prefetchShoutout() {}, stopAnnounce() {}, warmName() {},
    setVolume(value) { volume = Math.max(0, Math.min(1, Number(value) || 0)); },
    dispose() { disposed = true; stop(); },
  };
}
