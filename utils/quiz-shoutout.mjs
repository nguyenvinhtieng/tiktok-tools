// Shout-out for the fastest correct answer. Text is shared by the browser (popup, Web Speech)
// and the server (Edge TTS) so cached audio always matches what is shown.
export const SHOUTOUT_INTRO = 'Tuyệt vời!';
export const SHOUTOUT_FALLBACK_NAME = 'Có bạn';
const MAX_MS = 600000;

// TikTok nicknames often carry emoji, symbols and separators that TTS reads badly or spells out.
export function spokenName(name) {
  const clean = String(name ?? '').normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[_.\-·|~]+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, 40).join('').trim();
}
export function validShoutoutMs(ms) { return Number.isFinite(Number(ms)) && Number(ms) >= 0 && Number(ms) <= MAX_MS; }
// Rounded to 0.1 s so the spoken tail has a small, cacheable set of variants.
export function shoutoutSeconds(ms) {
  const tenths = Math.max(1, Math.round(Math.min(MAX_MS, Math.max(0, Number(ms) || 0)) / 100));
  return tenths % 10 ? `${Math.floor(tenths / 10)},${tenths % 10}` : String(tenths / 10);
}
// Spoken time uses whole seconds (max 60) so all 61 tails can be generated ahead of time.
export const shoutoutBucketMs = ms => { const s = Math.round(Math.min(MAX_MS, Math.max(0, Number(ms) || 0)) / 1000); return Math.min(60, s) * 1000; };
export const SHOUTOUT_TAIL_BUCKETS = Array.from({ length: 61 }, (_, i) => i * 1000);
export const shoutoutTail = ms => {
  const s = shoutoutBucketMs(ms) / 1000;
  return s < 1 ? 'trả lời đúng nhanh nhất, chưa tới 1 giây!' : `trả lời đúng nhanh nhất, chỉ trong ${s} giây!`;
};
export const shoutoutText = (name, ms) => `${SHOUTOUT_INTRO} ${spokenName(name) || SHOUTOUT_FALLBACK_NAME} ${shoutoutTail(ms)}`;

// Instant fallback: the OS/browser voice starts in milliseconds, no network round trip.
export function createBrowserShoutout({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, onState = () => {} } = {}) {
  const voice = () => {
    const voices = synth?.getVoices?.() || [];
    return voices.find(v => /^vi[-_]/i.test(v.lang) && v.localService) || voices.find(v => /^vi\b/i.test(v.lang));
  };
  let active = 0;
  return {
    available: () => Boolean(synth && Utterance),
    hasVietnamese: () => Boolean(voice()),
    speak(text, volume = 1) {
      if (!synth || !Utterance) return false;
      synth.cancel();
      const id = ++active, utterance = new Utterance(text), selected = voice();
      utterance.lang = selected?.lang || 'vi-VN';
      if (selected) utterance.voice = selected;
      utterance.volume = Math.max(0, Math.min(1, Number(volume) || 0));
      utterance.rate = 1.05;
      const done = () => { if (id === active) onState(false); };
      utterance.onend = done; utterance.onerror = done;
      onState(true); synth.speak(utterance);
      return true;
    },
    stop() { if (!synth) return; active++; synth.cancel(); onState(false); },
  };
}
