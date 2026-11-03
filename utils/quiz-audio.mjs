// Original, gently voiced quiz music. No downloads or third-party recordings.
export function createQuizAudio({ Context=globalThis.AudioContext || globalThis.webkitAudioContext, schedule=setInterval, cancel=clearInterval }={}) {
  let ctx, music, effects, master, timer, step=0, cursor=0, disposed=false, enabled=false;
  let musicLevel=.25, effectLevel=.35, lastCue=-Infinity;
  const clamp=value=>Number.isFinite(Number(value)) ? Math.max(0,Math.min(1,Number(value))) : 0;
  function volume(node,value) { if(node) node.gain.setTargetAtTime(value,ctx.currentTime,.12); }
  function note(bus,midi,time,duration,level=.1) {
    const oscillator=ctx.createOscillator(), gain=ctx.createGain();
    oscillator.type='sine'; oscillator.frequency.value=440*2**((midi-69)/12);
    gain.gain.setValueAtTime(0,time);
    gain.gain.linearRampToValueAtTime(level,time+.035);
    gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    oscillator.connect(gain); gain.connect(bus);
    oscillator.onended=()=>{ oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(time); oscillator.stop(time+duration+.02);
  }
  function fill() {
    if(!enabled || ctx.state!=='running') return;
    if(cursor<ctx.currentTime) cursor=ctx.currentTime+.05;
    const chords=[[48,55,60,64],[45,52,57,60],[53,57,60,65],[43,50,55,62]];
    while(cursor<ctx.currentTime+.6) {
      const chord=chords[Math.floor(step/16)%4], beat=step%16;
      if(beat===0 || beat===8) {
        note(music,chord[0]-12,cursor,2.4,.14);
        chord.slice(1).forEach((pitch,i)=>note(music,pitch,cursor+i*.025,2.8,.055));
      }
      // Two alternating phrases with rests, rather than a constant bright melody.
      const phrase=Math.floor(step/64)%2 ? [2,-1,1,-1,3,2,-1,1] : [1,-1,2,3,-1,2,1,-1];
      if(beat%2===0 && phrase[beat/2]>=0) note(music,chord[phrase[beat/2]]+12,cursor,.65,.07);
      step++; cursor+=60/84/2;
    }
  }
  return {
    async start() {
      if(disposed || !Context) throw new Error('Trình duyệt không hỗ trợ âm thanh.');
      if(!ctx) {
        ctx=new Context(); music=ctx.createGain(); effects=ctx.createGain(); master=ctx.createGain();
        const compressor=ctx.createDynamicsCompressor();
        compressor.threshold.value=-18; compressor.ratio.value=4;
        music.connect(master); effects.connect(master); master.connect(compressor); compressor.connect(ctx.destination);
        music.gain.value=musicLevel; effects.gain.value=effectLevel; master.gain.value=0;
      }
      await ctx.resume();
      if(disposed) return;
      if(ctx.state!=='running') throw new Error('Hãy bấm bật âm thanh để thử lại.');
      enabled=true; volume(master,.7);
      if(!timer) { cursor=ctx.currentTime+.05; fill(); timer=schedule(fill,200); }
    },
    stop() { enabled=false; volume(master,0); if(timer) cancel(timer); timer=undefined; },
    setLevels(background,fx) { musicLevel=clamp(background)*.65; effectLevel=clamp(fx)*.65; volume(music,musicLevel); volume(effects,effectLevel); },
    cue(kind) {
      if(!enabled || ctx.state!=='running' || ctx.currentTime-lastCue<.25) return;
      const patterns={question:[60,64],tick:[55],reveal:[60,64,67],winner:[60,64,67,72]};
      const pitches=patterns[kind]; if(!pitches) return;
      lastCue=ctx.currentTime;
      pitches.forEach((pitch,i)=>note(effects,pitch,ctx.currentTime+.02+i*.14,kind==='tick' ? .15 : .45,.16));
    },
    dispose() { this.stop(); disposed=true; if(ctx) void ctx.close().catch(()=>{}); },
  };
}
