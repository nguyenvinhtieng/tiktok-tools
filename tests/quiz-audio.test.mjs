import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuizAudio } from '../utils/quiz-audio.mjs';
function fixture() {
  const nodes=[], oscillators=[]; let scheduled=0,cancelled=0,closed=0;
  const param=()=>({value:0,setTargetAtTime(v){this.value=v;},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  class Context {
    currentTime=0; state='suspended'; destination={};
    createGain(){const node={gain:param(),connect(){},disconnect(){}};nodes.push(node);return node;}
    createDynamicsCompressor(){return {threshold:param(),ratio:param(),connect(){}};}
    createOscillator(){const node={frequency:param(),connect(){},disconnect(){},start(){},stop(){}};oscillators.push(node);return node;}
    async resume(){this.state='running';} async close(){closed++;}
  }
  return {audio:createQuizAudio({Context,schedule(){scheduled++;return 1;},cancel(){cancelled++;}}),nodes,oscillators,counts:()=>({scheduled,cancelled,closed})};
}
test('music starts only on request, uses one scheduler and stops/disposes cleanly',async()=>{
  const f=fixture(); assert.equal(f.oscillators.length,0);
  await f.audio.start(); await f.audio.start(); assert.equal(f.counts().scheduled,1);
  assert.ok(f.oscillators.length>0);
  f.audio.stop(); const count=f.oscillators.length; f.audio.cue('winner'); assert.equal(f.oscillators.length,count);
  await f.audio.start(); f.audio.dispose(); assert.deepEqual(f.counts(),{scheduled:2,cancelled:2,closed:1});
  await assert.rejects(()=>f.audio.start());
});
test('levels are bounded and cues cannot pile up on incoming events',async()=>{
  const f=fixture(); f.audio.setLevels(10,-2); await f.audio.start();
  assert.equal(f.nodes[0].gain.value,.65); assert.equal(f.nodes[1].gain.value,0);
  const before=f.oscillators.length; f.audio.cue('reveal'); f.audio.cue('winner');
  assert.equal(f.oscillators.length,before+3);
  f.audio.setLevels(NaN,Infinity); assert.equal(f.nodes[0].gain.value,0); assert.equal(f.nodes[1].gain.value,0);
});
