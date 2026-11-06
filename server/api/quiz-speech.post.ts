import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { WORDS } from '../../utils/quiz-words.mjs';
import { createSpeechCache } from '../utils/quiz-speech.mjs';
import { createEdgeSpeech } from '../utils/edge-speech.mjs';
import { SHOUTOUT_INTRO, SHOUTOUT_FALLBACK_NAME, SHOUTOUT_TAIL_BUCKETS, spokenName, shoutoutTail, validShoutoutMs } from '../../utils/quiz-shoutout.mjs';

// One cache instance also coalesces simultaneous generation requests.
const getAudio = createSpeechCache({
  directory: resolve(process.env.QUIZ_AUDIO_DIR || '.data/quiz-audio'),
  synthesize: createEdgeSpeech({ python: process.env.QUIZ_TTS_PYTHON || (existsSync('.venv/bin/python') ? resolve('.venv/bin/python') : 'python3') }),
  voices: { vi: process.env.QUIZ_TTS_VOICE_VI || 'vi-VN-HoaiMyNeural', en: process.env.QUIZ_TTS_VOICE_EN || 'en-US-JennyNeural' },
});
const words = new Map(WORDS.map(word => [word.answer, word]));

// Fastest-answer shout-out: three short clips so the static intro and repeat names/times hit the disk cache.
// Edge TTS can take several seconds per clip, so every fixed clip (intro, fallback name and the
// 61 whole-second tails) is generated once in the background and then served from disk.
let warmed = false, warming = false;
async function warmShoutout() {
  if (warmed || warming) return;
  warming = true;
  let failed = false;
  const clips = [[SHOUTOUT_INTRO, 'fastest-intro'], [SHOUTOUT_FALLBACK_NAME, 'fastest-anon'], ...SHOUTOUT_TAIL_BUCKETS.map(ms => [shoutoutTail(ms), 'fastest-time'])];
  for (const [text, part] of clips) {
    try { await getAudio(text, 'vi', { answer: part, part, limit: false }); } catch { failed = true; }
  }
  warmed = !failed; warming = false;
}
function shoutout(body: any) {
  if (body?.part === 'fastest-intro') { void warmShoutout(); return { text: SHOUTOUT_INTRO, answer: 'fastest-intro' }; }
  if (body?.part === 'fastest-anon') return { text: SHOUTOUT_FALLBACK_NAME, answer: 'fastest-anon' };
  if (body?.part === 'fastest-name') {
    if (typeof body.name !== 'string' || body.name.length > 200) return null;
    const name = spokenName(body.name) || SHOUTOUT_FALLBACK_NAME;
    return { text: name, answer: `fastest-name-${name}` };
  }
  if (body?.part === 'fastest-time' && validShoutoutMs(body.ms)) return { text: shoutoutTail(body.ms), answer: 'fastest-time' };
  return null;
}

export default defineEventHandler(async event => {
  const body = await readBody(event);
  if (String(body?.part || '').startsWith('fastest-')) {
    const clip = shoutout(body);
    if (!clip) throw createError({ statusCode: 400, statusMessage: 'Lời khen không hợp lệ.' });
    try {
      const audio = await getAudio(clip.text, 'vi', { answer: clip.answer, part: body.part });
      setResponseHeader(event, 'Content-Type', 'audio/mpeg');
      setResponseHeader(event, 'Cache-Control', 'no-store');
      return audio;
    } catch (error: any) {
      throw createError({ statusCode: error.statusCode || 500, statusMessage: 'Không phát được lời khen.', data: { message: error.statusCode ? error.message : 'Không lưu được audio trên server.' } });
    }
  }
  const word = words.get(body?.answer);
  if (!word || !['question', 'answer', 'meaning'].includes(body?.part)) throw createError({ statusCode: 400, statusMessage: 'Câu hỏi không hợp lệ.' });
  const text = body.part === 'question' ? `Từ tiếng Anh nào có nghĩa là: ${word.vi}?` : body.part === 'answer' ? word.answer : word.vi;
  try {
    const audio = await getAudio(text, body.part === 'answer' ? 'en' : 'vi', { answer: word.answer, part: body.part });
    setResponseHeader(event, 'Content-Type', 'audio/mpeg');
    setResponseHeader(event, 'Cache-Control', 'no-store');
    return audio;
  } catch (error: any) {
    throw createError({ statusCode: error.statusCode || 500, statusMessage: 'Không phát được giọng đọc.', data: { message: error.statusCode ? error.message : 'Không lưu được audio trên server.' } });
  }
});
