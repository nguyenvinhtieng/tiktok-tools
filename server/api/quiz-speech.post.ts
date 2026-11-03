import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { WORDS } from '../../utils/quiz-words.mjs';
import { createSpeechCache } from '../utils/quiz-speech.mjs';
import { createEdgeSpeech } from '../utils/edge-speech.mjs';

// One cache instance also coalesces simultaneous generation requests.
const getAudio = createSpeechCache({
  directory: resolve(process.env.QUIZ_AUDIO_DIR || '.data/quiz-audio'),
  synthesize: createEdgeSpeech({ python: process.env.QUIZ_TTS_PYTHON || (existsSync('.venv/bin/python') ? resolve('.venv/bin/python') : 'python3') }),
  voices: { vi: process.env.QUIZ_TTS_VOICE_VI || 'vi-VN-HoaiMyNeural', en: process.env.QUIZ_TTS_VOICE_EN || 'en-US-JennyNeural' },
});
const words = new Map(WORDS.map(word => [word.answer, word]));

export default defineEventHandler(async event => {
  const body = await readBody(event);
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
