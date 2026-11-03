import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const transient = error => error.killed || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(error.code)
  || /NoAudioReceived|ClientConnector(?:Error|DNSError)|ServerDisconnectedError|ConnectionResetError|TimeoutError/.test(error.stderr || '');

export function createEdgeSpeech({ python = 'python3', run = promisify(execFile) } = {}) {
  return async ({ text, voice, rate }) => {
    const directory = await mkdtemp(join(tmpdir(), 'quiz-edge-'));
    const path = join(directory, 'speech.mp3');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await run(python, ['-m', 'edge_tts', '--voice', voice, `--rate=${rate}`, '--text', text, '--write-media', path], { timeout: 35000, maxBuffer: 1048576 });
          break;
        } catch (error) {
          if (attempt || !transient(error)) throw error;
          await rm(path, { force: true });
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      return await readFile(path);
    } catch (error) {
      const missing = error.code === 'ENOENT' || /No module named.*edge_tts/.test(error.stderr || '');
      throw Object.assign(new Error(missing
        ? 'Chưa cài edge-tts. Cài requirements-tts.txt và cấu hình QUIZ_TTS_PYTHON trên server.'
        : 'Không tạo được giọng Edge TTS. Kiểm tra kết nối mạng hoặc thử lại.'), { statusCode: missing ? 503 : 502, cause: error });
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
