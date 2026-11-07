import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuizAudio } from '../utils/quiz-audio.mjs';
function fixture(resume) {
  const nodes=[], oscillators=[], sources=[], filters=[]; let scheduled=0,cancelled=0,closed=0;
  const param=()=>({value:0,cancelScheduledValues(){},setTargetAtTime(v){this.value=v;},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  class Context {
    currentTime=0; state='suspended'; destination={}; sampleRate=8;
    createGain(){const node={gain:param(),connect(){},disconnect(){}};nodes.push(node);return node;}
    createDynamicsCompressor(){return {threshold:param(),ratio:param(),connect(){}};}
    createBiquadFilter(){const node={frequency:param(),Q:param(),connect(){},disconnect(){}};filters.push(node);return node;}
    createBuffer(channels,length){const data=new Float32Array(length);return {getChannelData:()=>data};}
    createBufferSource(){const node={connect(){},disconnect(){},start(){},stop(){}};sources.push(node);return node;}
    createOscillator(){const node={frequency:param(),connect(){},disconnect(){},start(){},stop(){}};oscillators.push(node);return node;}
    async resume(){this.state='running';} async close(){closed++;}
  }
  if(resume) Context.prototype.resume=resume;
  const audio=createQuizAudio({Context,schedule(){scheduled++;return 1;},cancel(){cancelled++;}});
  return {audio,nodes,oscillators,sources,filters,voices:()=>oscillators.length+sources.length,counts:()=>({scheduled,cancelled,closed})};
}
test('music starts only on request, uses one scheduler and stops/disposes cleanly',async()=>{
  const f=fixture(); assert.equal(f.voices(),0);
  await f.audio.start(); await f.audio.start(); assert.equal(f.counts().scheduled,1);
  assert.ok(f.voices()>0);
  f.audio.stop(); const count=f.voices(); f.audio.cue('winner'); assert.equal(f.voices(),count);
  await f.audio.start(); f.audio.dispose(); assert.deepEqual(f.counts(),{scheduled:2,cancelled:2,closed:1});
  await assert.rejects(()=>f.audio.start());
});
test('blocked mobile audio times out, ignores late completion and permits retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let release, attempts=0;
  const f=fixture(function(){
    if(++attempts===1) return new Promise(resolve=>{release=()=>{this.state='running';resolve();};});
    this.state='running'; return Promise.resolve();
  });
  const rejected=assert.rejects(f.audio.start(),/bấm bật âm thanh/);
  t.mock.timers.tick(3000);
  await rejected;
  release(); await Promise.resolve();
  assert.equal(f.counts().scheduled,0);
  assert.equal(f.voices(),0);
  await f.audio.start();
  assert.equal(f.counts().scheduled,1);
  f.audio.dispose();
});
test('levels are bounded and repeated cues cannot pile up on incoming events',async()=>{
  const f=fixture(); f.audio.setLevels(10,-2); await f.audio.start();
  assert.equal(f.nodes[0].gain.value,.65); assert.equal(f.nodes[1].gain.value,0);
  let before=f.voices(); f.audio.cue('correct'); assert.ok(f.voices()>before);
  before=f.voices(); f.audio.cue('correct'); f.audio.cue('correct'); assert.equal(f.voices(),before);
  before=f.voices(); f.audio.cue('unknown'); assert.equal(f.voices(),before);
  f.audio.setLevels(NaN,Infinity); assert.equal(f.nodes[0].gain.value,0); assert.equal(f.nodes[1].gain.value,0);
});
test('speech ducks and muffles music, preserves sliders and restores levels across restart',async()=>{
  const f=fixture();
  f.audio.setLevels(.4,.6); f.audio.setSpeechActive(true); await f.audio.start();
  const musicFilter=f.filters[0];
  assert.ok(f.nodes[0].gain.value<.04);
  assert.ok(f.nodes[1].gain.value<.6*.65*.5);
  assert.ok(musicFilter.frequency.value<1000);
  f.audio.setLevels(.8,.5);
  assert.ok(f.nodes[0].gain.value<.08);
  f.audio.stop(); await f.audio.start();
  assert.ok(f.nodes[0].gain.value<.08);
  f.audio.setSpeechActive(false);
  assert.equal(f.nodes[0].gain.value,.8*.65);
  assert.equal(f.nodes[1].gain.value,.5*.65);
  assert.ok(musicFilter.frequency.value>10000);
});
test('countdown music gets denser as tension rises',async()=>{
  const voicesFor=async tension=>{
    const f=fixture(); f.audio.setPhase('countdown'); f.audio.setTension(tension); await f.audio.start();
    return f.voices();
  };
  assert.ok(await voicesFor(1)>await voicesFor(0));
});
test('reveal plays a drum roll and differs with and without winners',async()=>{
  const f=fixture(); await f.audio.start();
  let before=f.sources.length; f.audio.cue('reveal',true);
  const roll=f.sources.length-before; assert.ok(roll>10);
  const g=fixture(); await g.audio.start();
  const oscBefore=g.oscillators.length; g.audio.cue('reveal',false);
  assert.ok(g.sources.length<f.sources.length);
  assert.ok(g.oscillators.length>oscBefore);
});
