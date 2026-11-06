import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserQuizSpeech } from '../utils/quiz-browser-speech.mjs';

function fixture() {
  const spoken=[], states=[], errors=[];
  const synth={getVoices:()=>[{lang:'vi-VN',localService:true},{lang:'en-US',localService:true}],cancel(){},resume(){},speak(u){spoken.push(u);}};
  const speech=createBrowserQuizSpeech({synth,Utterance:class {constructor(text){this.text=text;}},onState:v=>states.push(v),onError:e=>errors.push(e)});
  return {speech,spoken,states,errors};
}
test('question uses Vietnamese directly and answer sequences English then Vietnamese',async()=>{
  const f=fixture(); await f.speech.start();
  const question=f.speech.speak('apple');
  assert.match(f.spoken[0].text,/Từ tiếng Anh nào có nghĩa là:/);
  assert.equal(f.spoken[0].lang,'vi-VN');
  f.spoken[0].onend(); assert.equal(await question,true);
  f.speech.setVolume(.4);
  const answer=f.speech.speak('apple',true);
  assert.equal(f.spoken[1].text,'apple'); assert.equal(f.spoken[1].lang,'en-US');
  assert.equal(f.spoken[1].volume,.4);
  f.spoken[1].onend(); await Promise.resolve();
  assert.equal(f.spoken[2].lang,'vi-VN'); f.spoken[2].onend();
  assert.equal(await answer,true); assert.equal(f.states.at(-1),false);
});
test('replacement and disposal settle old reads without stale callbacks affecting new ones',async()=>{
  const f=fixture(); const first=f.speech.speak('apple',true), stale=f.spoken[0].onend;
  const second=f.speech.speak('apple'); assert.equal(await first,false);
  stale(); assert.equal(f.states.at(-1),true);
  f.speech.dispose(); assert.equal(await second,false); assert.equal(f.states.at(-1),false);
});
test('unsupported synthesis and playback errors report failures',async()=>{
  await assert.rejects(createBrowserQuizSpeech({synth:null}).start(),/không hỗ trợ/);
  const f=fixture(); const reading=f.speech.speak('apple');
  f.spoken[0].onerror({error:'not-allowed'});
  assert.equal(await reading,false); assert.equal(f.errors.length,1);
});
test('quiz defaults both audio switches on and arms activation for pointer and keyboard',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  assert.match(source,/soundEnabled=ref\(true\)/);
  assert.match(source,/speechEnabled=ref\(true\)/);
  assert.match(source,/shoutVoice=ref\('browser'\)/);
  for(const event of ['pointerdown','keydown']) {
    assert.ok(source.includes(`document.addEventListener('${event}',activateDefaultAudio)`));
    assert.ok(source.includes(`document.removeEventListener('${event}',activateDefaultAudio)`));
  }
});
