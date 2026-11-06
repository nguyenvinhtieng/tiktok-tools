import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const slug = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'word';
export function createSpeechCache({ directory, synthesize, provider = 'edge-tts-v1', voices = { vi: 'vi-VN-HoaiMyNeural', en: 'en-US-JennyNeural' }, speed = '+0%' }) {
  const pending = new Map();
  let requests = [];
  return async function getAudio(text, language, { answer = text, part = language, limit = true } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 500 || !['vi', 'en'].includes(language)) throw failure(400, 'Nội dung đọc không hợp lệ.');
    const payload = { text: text.trim(), voice: voices[language], rate: speed };
    const key = createHash('sha256').update(JSON.stringify({ version: 1, provider, language, ...payload })).digest('hex');
    // 80 hash bits keep names compact while separating content, voice and settings.
    const label = ['question', 'answer', 'meaning'].includes(part) ? part : language;
    const path = join(directory, `${slug(answer)}-${label}-${key.slice(0, 20)}.mp3`);
    try { const cached = await readFile(path); if (cached.length) return cached; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (pending.has(key)) return pending.get(key);
    const generate = async () => {
      const legacy = join(directory, `${key}.mp3`);
      try {
        const cached = await readFile(legacy);
        if (cached.length) {
          try { await rename(legacy, path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          return cached;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!synthesize) throw failure(503, 'Chưa cấu hình dịch vụ tạo giọng đọc trên server.');
      // limit:false is only for bounded, server-initiated warm-up (fixed shout-out clips).
      if (limit) {
        requests = requests.filter(time => time > Date.now() - 60000);
        if (requests.length >= 60) throw failure(429, 'Đã giới hạn tạo giọng đọc. Vui lòng thử lại sau một phút.');
        requests.push(Date.now());
      }
      await mkdir(directory, { recursive: true });
      const audio = await synthesize(payload);
      if (!Buffer.isBuffer(audio) || audio.length < 4 || audio.length > 10000000 || !(audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224))) throw failure(502, 'Dịch vụ giọng đọc không trả về file MP3 hợp lệ.');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, audio, { flag: 'wx' }); await rename(temporary, path); }
      finally { await rm(temporary, { force: true }); }
      return audio;
    };
    const promise = generate();
    pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  };
}
