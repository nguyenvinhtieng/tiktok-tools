// Original synthesized game-show music and stingers. No downloads or third-party recordings.
const freq=midi=>440*2**((midi-69)/12);
// Am – F – Dm – E: minor suspense with a leading-tone pull back to the start.
const SUSPENSE=[[45,57,60,64],[41,57,60,65],[38,57,62,65],[40,56,59,64]];
const SUSPENSE_ARP=[1,0,2,0,3,0,2,0,1,0,2,0,3,2,1,0];
// C – Am – F – G: bright game-show groove between questions.
const GROOVE=[[48,60,64,67],[45,60,64,69],[41,60,65,69],[43,59,62,67]];
const MELODY=[
  [[0,72,2],[2,76,2],[4,79,3],[8,76,2],[10,79,2],[12,84,4]],
  [[0,81,3],[4,79,2],[6,76,2],[8,72,4],[12,76,2],[14,74,2]],
  [[0,77,2],[2,81,2],[4,84,3],[8,81,2],[10,77,2],[12,76,4]],
  [[0,74,3],[4,79,2],[6,83,2],[8,86,4],[12,83,2],[14,79,2]],
];
const QUESTION=new Set(['reading','countdown']);
const COOLDOWN={correct:.15,tick:.4};
// Speech must stay on top: music drops hard and loses the voice band, stingers dip less so they still land.
const DUCK={music:.1,effects:.35,cutoff:650};

export function createQuizAudio({ Context=globalThis.AudioContext || globalThis.webkitAudioContext, schedule=setInterval, cancel=clearInterval }={}) {
  let ctx, music, effects, master, musicFilter, noiseBuffer, timer, step=0, cursor=0, disposed=false, enabled=false;
  let musicLevel=.25, effectLevel=.35, speechActive=false, phase='lobby', tension=0;
  const lastCue={};
  const clamp=value=>Number.isFinite(Number(value)) ? Math.max(0,Math.min(1,Number(value))) : 0;
  function volume(node,value,fade=.12) {
    if(!node) return;
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setTargetAtTime(value,ctx.currentTime,fade);
  }
  function mix() {
    volume(music,musicLevel*(speechActive ? DUCK.music : 1),speechActive ? .03 : .4);
    volume(effects,effectLevel*(speechActive ? DUCK.effects : 1),speechActive ? .03 : .3);
    if(musicFilter) musicFilter.frequency.setTargetAtTime(speechActive ? DUCK.cutoff : 18000,ctx.currentTime,speechActive ? .04 : .5);
  }
  function envelope(gain,time,attack,duration,level) {
    gain.gain.setValueAtTime(0,time);
    gain.gain.linearRampToValueAtTime(level,time+attack);
    gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
  }
  function tone(bus,midi,time,duration,{level=.1,type='sine',attack=.01,cutoff=0,glide=0}={}) {
    const oscillator=ctx.createOscillator(), gain=ctx.createGain();
    let out=oscillator, filter;
    oscillator.type=type; oscillator.frequency.setValueAtTime(freq(midi),time);
    if(glide) oscillator.frequency.exponentialRampToValueAtTime(freq(midi+glide),time+duration);
    if(cutoff) { filter=ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=cutoff; oscillator.connect(filter); out=filter; }
    envelope(gain,time,attack,duration,level);
    out.connect(gain); gain.connect(bus);
    oscillator.onended=()=>{ oscillator.disconnect(); filter?.disconnect(); gain.disconnect(); };
    oscillator.start(time); oscillator.stop(time+duration+.05);
  }
  function noise(bus,time,duration,{level=.1,type='highpass',frequency=7000,q=.7,attack=.002}={}) {
    const source=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), gain=ctx.createGain();
    source.buffer=noiseBuffer; filter.type=type; filter.frequency.value=frequency; filter.Q.value=q;
    envelope(gain,time,attack,duration,level);
    source.connect(filter); filter.connect(gain); gain.connect(bus);
    source.onended=()=>{ source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(time,Math.random()*.5); source.stop(time+duration+.05);
  }
  function kick(bus,time,level=.4) { tone(bus,50,time,.32,{level,attack:.004,glide:-24}); }

  function suspense(time,beat,bar) {
    const reading=phase==='reading', t=reading ? 0 : tension, chord=SUSPENSE[bar];
    // Tension builds through layers and filter, not tempo: a racing clock gets tiring on a long live.
    const sixteenth=60/(reading ? 96 : 108+t*8)/4;
    if(beat===0) chord.slice(1).forEach(pitch=>tone(music,pitch,time,sixteenth*16+.3,{level:.03,type:'sawtooth',attack:.3,cutoff:700+t*1800}));
    if(reading) {
      if(beat%8===0) tone(music,chord[0],time,sixteenth*7,{level:.14,type:'triangle',attack:.02});
      if(beat%4===0) noise(music,time,.03,{level:.08,type:'bandpass',frequency:3000,q:6});
      return sixteenth;
    }
    if(beat%4===0) tone(music,chord[0],time,sixteenth*3.2,{level:.18,type:'sawtooth',cutoff:300+t*700});
    // Clock tick-tock on every beat.
    if(beat%4===0) noise(music,time,.035,{level:.26,type:'bandpass',frequency:3400,q:8});
    if(beat%4===2) noise(music,time,.035,{level:.16,type:'bandpass',frequency:2200,q:8});
    if(t>.3 && SUSPENSE_ARP[beat]) tone(music,chord[SUSPENSE_ARP[beat]]+12,time,sixteenth*1.6,{level:.016+t*.016,type:'triangle',cutoff:2000});
    if(t>.5 && beat%4===2) noise(music,time,.03,{level:.03+(t-.5)*.05});
    if(t>.65 && (beat===0 || beat===3)) kick(music,time,beat===0 ? .4 : .26);
    return sixteenth;
  }
  function groove(time,beat,bar) {
    const chord=GROOVE[bar], sixteenth=60/118/4, bright=phase==='results';
    if(beat%4===0) kick(music,time,.42);
    if(beat===4 || beat===12) noise(music,time,.14,{level:.2,type:'bandpass',frequency:1500,q:.9});
    if(beat%4===2) noise(music,time,.05,{level:.09});
    else if(beat%2) noise(music,time,.025,{level:.035,frequency:9000});
    if([0,3,6,8,10,14].includes(beat)) tone(music,chord[0]+(beat===6 || beat===14 ? 12 : 0),time,sixteenth*1.6,{level:.17,type:'sawtooth',cutoff:800});
    if(beat%4===2) chord.slice(1).forEach(pitch=>tone(music,pitch,time,sixteenth*1.2,{level:.022,type:'square',cutoff:2000}));
    const lead=bright || Math.floor(step/64)%2===0;
    const melody=lead && MELODY[bar].find(([at])=>at===beat);
    if(melody) {
      tone(music,melody[1],time,sixteenth*melody[2],{level:.045,type:'square',cutoff:3200,attack:.008});
      tone(music,melody[1]-12,time,sixteenth*melody[2],{level:.03,type:'triangle'});
    } else if(!lead && beat%2===0) tone(music,chord[1+(beat/2)%3]+12,time,sixteenth*.8,{level:.025,type:'triangle'});
    if(bright && beat%8===7) tone(music,96+(bar%2)*3,time,.25,{level:.015});
    return sixteenth;
  }
  function fill() {
    if(!enabled || ctx.state!=='running') return;
    if(cursor<ctx.currentTime) cursor=ctx.currentTime+.05;
    while(cursor<ctx.currentTime+.3) {
      const beat=step%16, bar=Math.floor(step/16)%4;
      cursor+=QUESTION.has(phase) ? suspense(cursor,beat,bar) : groove(cursor,beat,bar);
      step++;
    }
  }

  const cues={
    // Lottery wheel: accelerating blips that land on a chord hit.
    question(t) {
      const scale=[0,2,4,5,7,9,11,12,14,16,17,19,21,24];
      let at=0;
      scale.forEach((offset,i)=>{ tone(effects,60+offset,t+at,.08,{level:.06,type:'square',cutoff:3000}); at+=.075-i*.003; });
      [57,60,64,69].forEach(pitch=>tone(effects,pitch,t+at,.8,{level:.05,type:'sawtooth',cutoff:2600}));
      noise(effects,t+at,.6,{level:.12,frequency:4000}); kick(effects,t+at,.55);
    },
    tick(t,seconds) {
      const last=Number(seconds)<=1;
      tone(effects,last ? 88 : 81,t,last ? .35 : .12,{level:.16});
      tone(effects,last ? 76 : 69,t,last ? .35 : .12,{level:.05,type:'square',cutoff:2500});
    },
    // Drum roll, then either a cymbal + brass "ta-da" or a sad trombone when nobody got it.
    reveal(t,hasWinners) {
      for(let at=0;at<.9;at+=.035) noise(effects,t+at,.05,{level:.04+at*.2,type:'bandpass',frequency:1800,q:.8});
      const hit=t+.9;
      if(hasWinners) {
        noise(effects,hit,1.4,{level:.22,frequency:5000}); kick(effects,hit,.6);
        [60,64,67,72].forEach(pitch=>tone(effects,pitch,hit,1.1,{level:.06,type:'sawtooth',cutoff:3000}));
        [84,88,91,96].forEach((pitch,i)=>tone(effects,pitch,hit+.1+i*.07,.4,{level:.04,type:'triangle'}));
      } else {
        [67,66,65,64].forEach((pitch,i)=>tone(effects,pitch,hit+i*.35,i===3 ? .9 : .33,{level:.08,type:'sawtooth',cutoff:1200,attack:.03,glide:i===3 ? -1 : 0}));
      }
    },
    correct(t) {
      tone(effects,83,t,.08,{level:.05,type:'square',cutoff:4000});
      tone(effects,88,t+.08,.4,{level:.05,type:'square',cutoff:4000});
    },
    // First correct answer: a quick rising sparkle, short so the shout-out voice can follow.
    fastest(t) {
      [76,79,84,88].forEach((pitch,i)=>tone(effects,pitch,t+i*.06,.18,{level:.06,type:'square',cutoff:4200,attack:.004}));
      [88,91,96].forEach(pitch=>tone(effects,pitch,t+.24,.45,{level:.035,type:'triangle'}));
      noise(effects,t+.24,.35,{level:.08,frequency:8000});
    },
    winner(t) {
      [0,.12,.24].forEach(at=>tone(effects,67,t+at,.1,{level:.06,type:'sawtooth',cutoff:2800}));
      [72,76,79].forEach(pitch=>tone(effects,pitch,t+.36,1,{level:.05,type:'sawtooth',cutoff:3000}));
      kick(effects,t+.36,.5);
      [96,100,103].forEach((pitch,i)=>tone(effects,pitch,t+.5+i*.08,.3,{level:.03,type:'triangle'}));
    },
  };

  return {
    async start() {
      if(disposed || !Context) throw new Error('Trình duyệt không hỗ trợ âm thanh.');
      if(!ctx) {
        ctx=new Context(); music=ctx.createGain(); effects=ctx.createGain(); master=ctx.createGain();
        musicFilter=ctx.createBiquadFilter(); musicFilter.type='lowpass';
        musicFilter.frequency.value=speechActive ? DUCK.cutoff : 18000;
        const compressor=ctx.createDynamicsCompressor();
        compressor.threshold.value=-18; compressor.ratio.value=4;
        noiseBuffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
        const data=noiseBuffer.getChannelData(0);
        for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
        music.connect(musicFilter); musicFilter.connect(master); effects.connect(master); master.connect(compressor); compressor.connect(ctx.destination);
        music.gain.value=musicLevel*(speechActive ? DUCK.music : 1); effects.gain.value=effectLevel*(speechActive ? DUCK.effects : 1); master.gain.value=0;
      }
      await ctx.resume();
      if(disposed) return;
      if(ctx.state!=='running') throw new Error('Hãy bấm bật âm thanh để thử lại.');
      enabled=true; volume(master,.7);
      if(!timer) { cursor=ctx.currentTime+.05; fill(); timer=schedule(fill,100); }
    },
    stop() { enabled=false; volume(master,0); if(timer) cancel(timer); timer=undefined; },
    setLevels(background,fx) { musicLevel=clamp(background)*.65; effectLevel=clamp(fx)*.65; mix(); },
    setSpeechActive(active) { speechActive=Boolean(active); mix(); },
    setTension(value) { tension=clamp(value); },
    setPhase(next) {
      if(next===phase) return;
      const previous=phase; phase=next;
      if(!ctx || !enabled) return;
      // Leave room for the stinger that accompanies each transition.
      const delay=QUESTION.has(next) && !QUESTION.has(previous) ? .9 : next==='results' ? 1.4 : previous==='results' ? 1 : 0;
      step=0; cursor=ctx.currentTime+.05+delay;
    },
    cue(kind,detail) {
      const play=cues[kind];
      if(!play || !enabled || ctx.state!=='running') return;
      const now=ctx.currentTime;
      if(now-(lastCue[kind] ?? -Infinity)<(COOLDOWN[kind] ?? .6)) return;
      lastCue[kind]=now; play(now+.02,detail);
    },
    dispose() { this.stop(); disposed=true; if(ctx) void ctx.close().catch(()=>{}); },
  };
}
