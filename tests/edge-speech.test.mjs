import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEdgeSpeech } from '../server/utils/edge-speech.mjs';

test('edge adapter returns real MP3 bytes using argument array and removes temporary files', async () => {
  let temporary;
  const audio = Buffer.from('ID3mock-audio');
  const synthesize = createEdgeSpeech({ python: '/custom/python', run: async (program, args, options) => {
    assert.equal(program, '/custom/python');
    assert.deepEqual(args.slice(0, 2), ['-m', 'edge_tts']);
    assert.equal(args[args.indexOf('--text') + 1], 'hello $(echo test)');
    assert.equal(args[args.indexOf('--voice') + 1], 'en-US-JennyNeural');
    assert.ok(args.includes('--rate=+0%'));
    assert.ok(!options.shell);
    assert.equal(options.timeout, 35000);
    temporary = args[args.indexOf('--write-media') + 1];
    await writeFile(temporary, audio);
  } });
  assert.deepEqual(await synthesize({ text: 'hello $(echo test)', voice: 'en-US-JennyNeural', rate: '+0%' }), audio);
  await assert.rejects(access(dirname(temporary)), { code: 'ENOENT' });
});

test('edge adapter distinguishes missing installation from provider failures and always cleans up', async () => {
  for (const [error, statusCode] of [[Object.assign(new Error('missing'), { code: 'ENOENT' }), 503], [Object.assign(new Error('module'), { stderr: 'No module named edge_tts' }), 503], [new Error('network timeout'), 502]]) {
    let temporary;
    const synthesize = createEdgeSpeech({ run: async (program, args) => { temporary = args[args.indexOf('--write-media') + 1]; await writeFile(temporary, 'partial'); throw error; } });
    await assert.rejects(synthesize({ text: 'xin chào', voice: 'vi-VN-HoaiMyNeural', rate: '+0%' }), { statusCode });
    await assert.rejects(access(dirname(temporary)), { code: 'ENOENT' });
  }
});

test('edge adapter retries a transient provider failure once and cleans partial audio', async () => {
  let calls = 0;
  const audio = Buffer.from('ID3recovered-audio');
  const synthesize = createEdgeSpeech({ run: async (program, args) => {
    const path = args[args.indexOf('--write-media') + 1];
    if (++calls === 1) {
      await writeFile(path, 'partial');
      throw Object.assign(new Error('provider unavailable'), { stderr: 'edge_tts.exceptions.NoAudioReceived: No audio was received' });
    }
    await assert.rejects(access(path), { code: 'ENOENT' });
    await writeFile(path, audio);
  } });
  assert.deepEqual(await synthesize({ text: 'Tấm thảm', voice: 'vi-VN-HoaiMyNeural', rate: '+0%' }), audio);
  assert.equal(calls, 2);
});

test('edge adapter bounds transient retries and retains the underlying cause privately', async () => {
  let calls = 0, temporary;
  const cause = Object.assign(new Error('network timeout'), { killed: true });
  const synthesize = createEdgeSpeech({ run: async (program, args) => {
    calls++; temporary = args[args.indexOf('--write-media') + 1]; throw cause;
  } });
  await assert.rejects(synthesize({ text: 'Tấm thảm', voice: 'vi-VN-HoaiMyNeural', rate: '+0%' }), error => {
    assert.equal(error.statusCode, 502);
    assert.equal(error.cause, cause);
    assert.ok(!error.message.includes('network timeout'));
    return true;
  });
  assert.equal(calls, 2);
  await assert.rejects(access(dirname(temporary)), { code: 'ENOENT' });
});

test('edge adapter does not retry installation or permanent provider errors', async () => {
  for (const error of [Object.assign(new Error('missing'), { code: 'ENOENT' }), Object.assign(new Error('unauthorized'), { stderr: 'WSServerHandshakeError: 403 Forbidden' })]) {
    let calls = 0;
    const synthesize = createEdgeSpeech({ run: async () => { calls++; throw error; } });
    await assert.rejects(synthesize({ text: 'apple', voice: 'en-US-JennyNeural', rate: '+0%' }));
    assert.equal(calls, 1);
  }
});
