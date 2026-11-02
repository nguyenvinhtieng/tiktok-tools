import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startRound, roundHint, acceptChat, settleRound, acceptGift, pickWord, drawWord, normalize, POINTS, saveGame, restoreGame, STORAGE_KEY } from '../utils/quiz.mjs';
import { WORDS } from '../utils/quiz-words.mjs';
test('deferred answers keep scores unchanged until results finish and settle once', () => {
  const game=createGame();
  startRound(game,{answer:'apple',band:'A2'},1000,30);
  acceptGift(game,{userId:'a',nickname:'An',gift:{diamondCount:2},msgId:'gift'});
  assert.equal(acceptChat(game,{userId:'a',nickname:'An',comment:'apple'},2000,true),20);
  assert.equal(acceptChat(game,{userId:'b',nickname:'Bình',comment:'apple'},10000,true),10);
  assert.equal(acceptChat(game,{userId:'a',comment:'apple'},11000,true),0);
  assert.equal(game.players.a.score,20);
  assert.equal(game.players.b,undefined);
  assert.deepEqual(game.round.results.map(r=>[r.id,r.elapsed,r.points]),[['a',1000,20],['b',9000,10]]);
  assert.deepEqual(settleRound(game),[]);
  game.round.revealed=true;
  assert.equal(settleRound(game).length,2);
  assert.equal(game.players.a.score,40);
  assert.equal(game.players.b.score,10);
  assert.equal(game.players.a.correct,1);
  assert.deepEqual(settleRound(game),[]);
});
test('restoring pending results credits answers once without losing gifts', () => {
  const game=createGame(); startRound(game,{answer:'apple',band:'A1'},1000,30);
  acceptChat(game,{userId:'a',nickname:'An',comment:'apple'},2000,true);
  const storage={value:'',setItem(k,v){this.value=v;},getItem(){return this.value;}};
  saveGame(storage,game);
  const restored=restoreGame(storage);
  assert.equal(restored.players.a.score,10);
  assert.deepEqual(settleRound(restored),[]);
});
test('quiz shows results for five seconds before score animation and next round', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  let clock=1000, tick;
  class Clock extends Date { static now(){return clock;} }
  const state=runInNewContext(script+`; startRound(game.value,{answer:'apple',band:'A1'},1000,15);
    running.value=true; acceptChat(game.value,{userId:'a',nickname:'An',comment:'apple'},2000,true);
    ({game,resultsOpen,scoreAwards,next});`,{
    Date:Clock,ref:value=>({value}),computed:get=>({get value(){return get();}}),
    createGame,startRound,acceptChat,settleRound,roundHint,drawWord,POINTS,WORDS,
    onMounted:fn=>fn(),onBeforeUnmount:()=>{},watch:()=>{},
    document:{addEventListener(){}},setInterval:fn=>{tick=fn;},
  });
  clock=16000; tick();
  assert.equal(state.resultsOpen.value,true);
  assert.equal(state.game.value.players.a,undefined);
  state.next(); assert.equal(state.game.value.round.deadline,16000);
  clock=20999; tick(); assert.equal(state.game.value.players.a,undefined);
  clock=21000; tick();
  assert.equal(state.resultsOpen.value,false);
  assert.equal(state.game.value.players.a.score,10);
  assert.equal(state.scoreAwards.value.a,10);
  clock=22799; tick(); assert.equal(state.game.value.round.deadline,16000);
  clock=22800; tick();
  assert.ok(state.game.value.round.deadline>22800);
  assert.equal(state.game.value.players.a.score,10);
  assert.equal(Object.keys(state.scoreAwards.value).length,0);
  assert.doesNotMatch(source,/<section class="participant-activity"/);
});
test('live activity shows real incoming actions before quiz starts and keeps three newest', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  let receive;
  class EventSource { addEventListener(type,callback){receive=callback;} close(){} }
  const state=runInNewContext(script+`; connect(); ({activity,game});`,{
    ref:value=>({value}),computed:get=>({get value(){return get();}}),createGame,POINTS,WORDS,EventSource,
    parseLiveUrl:()=>{},onMounted:()=>{},onBeforeUnmount:()=>{},watch:()=>{},
  });
  const send=(type,data={})=>receive({data:JSON.stringify({type,data})});
  send('connected'); send('member',{user:{nickname:'An'}});
  send('chat',{user:{nickname:'Bình'},comment:'ABC'});
  send('gift',{user:{nickname:'Chi'},gift:{name:'Rose'},repeatCount:2});
  assert.equal(state.activity.value.length,3);
  assert.match(state.activity.value[0].text,/Chi.*Rose.*2/);
  assert.equal(state.activity.value[1].text,'Bình: ABC');
  assert.match(state.activity.value[2].text,/An.*tham gia/);
  send('heartbeat'); assert.equal(state.activity.value.length,3);
  assert.equal(Object.keys(state.game.value.players).length,0);
});
test('countdown tracks fractional time, clamps to zero and resets for the next round', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  const fixture=createGame(); startRound(fixture,{answer:'apple',band:'A1'},1000,15);
  const state=runInNewContext(script+`; game.value=fixture; now.value=9250;
    const mid={ms:remainingMs.value,seconds:remaining.value,ratio:timeRatio.value};
    now.value=17000; const expired=remainingMs.value;
    startRound(game.value,{answer:'red',band:'A1'},17000,30);
    const resetRatio=timeRatio.value; game.value.round.revealed=true;
    ({mid,expired,reset:resetRatio,revealed:remainingMs.value});`,{
    ref:value=>({value}),computed:get=>({get value(){return get();}}),createGame,startRound,POINTS,WORDS,fixture,
    onMounted:()=>{},onBeforeUnmount:()=>{},watch:()=>{},
  });
  assert.equal(state.mid.ms,6750);
  assert.equal(state.mid.seconds,7);
  assert.equal(state.mid.ratio,0.45);
  assert.equal(state.expired,0);
  assert.equal(state.reset,1);
  assert.equal(state.revealed,0);
});
test('hints reveal the first letter then one stable random letter at exact thresholds', () => {
  const game=createGame(); startRound(game,{answer:'ice cream',band:'A2'},1000,15,()=>0.99);
  assert.deepEqual(roundHint(game.round,8999),{text:'_ _ _ / _ _ _ _ _',divisor:1,points:20});
  assert.deepEqual(roundHint(game.round,9000),{text:'i _ _ / _ _ _ _ _',divisor:2,points:10});
  assert.equal(roundHint(game.round,12999).divisor,2);
  const final=roundHint(game.round,13000);
  assert.deepEqual(final,{text:'i _ _ / _ _ _ _ m',divisor:3,points:6});
  assert.deepEqual(roundHint(game.round,14000),final);
  startRound(game,{answer:'a',band:'A1'},20000,60,()=>0);
  assert.equal(roundHint(game.round,32000).text,'a');
  startRound(game,{answer:'apple',band:'A1'},40000,30,()=>0);
  assert.equal(roundHint(game.round,40000).text,'_ _ _ _ _');
  assert.equal(roundHint(game.round,52000).text,'a p _ _ _');
});
test('chat awards floored reduced points at 8s and 12s for every duration', () => {
  for(const seconds of [15,30,45,60]) {
    const game=createGame(); startRound(game,{answer:'apple',band:'A1'},1000,seconds);
    for(const [id,time,points] of [['a',8999,10],['b',9000,5],['c',12999,5],['d',13000,3]])
      assert.equal(acceptChat(game,{userId:id,comment:'apple'},time),points);
    assert.equal(acceptChat(game,{userId:'d',comment:'apple'},14000),0);
    assert.equal(acceptChat(game,{userId:'late',comment:'apple'},1000+seconds*1000),0);
    const storage={setItem(k,v){this.value=v;},getItem(){return this.value;}};
    saveGame(storage,game);
    assert.equal(restoreGame(storage).players.d.score,3);
  }
});
test('dataset has all bands, unique answers and Vietnamese prompts', () => {
  for (const band of Object.keys(POINTS)) assert.ok(WORDS.some(w => w.band === band));
  assert.equal(new Set(WORDS.map(w => w.answer)).size, WORDS.length);
  assert.ok(WORDS.every(w => w.vi && w.answer && POINTS[w.band]));
});
test('weighted selection excludes last word and respects selected band', () => {
  assert.equal(pickWord(WORDS, '', 'C2', () => 0).band, 'C2');
  const first = pickWord(WORDS, '', 'mixed', () => 0);
  assert.notEqual(pickWord(WORDS, first.answer, 'mixed', () => 0).answer, first.answer);
  const counts = {};
  for (let i=0;i<1000;i++) { const w=pickWord(WORDS, '', 'mixed', () => i/1000); counts[w.band]=(counts[w.band]||0)+1; }
  assert.ok((counts.A2+counts.B1+counts.B2+counts.C1)>900);
});
test('contained normalized answers score once per user per round within deadline', () => {
  const game=createGame(); startRound(game, {answer:'apple', band:'A1'}, 1000, 30);
  assert.equal(normalize(' APPLE! '), 'apple');
  assert.equal(acceptChat(game,{user:{userId:'1',nickname:'A'},comment:'unrelated'},1100),0);
  assert.equal(acceptChat(game,{user:{userId:'1',nickname:'A'},comment:'Đáp án là ÁPPLÉ! '},1100),10);
  assert.equal(acceptChat(game,{user:{userId:'1'},comment:'apple'},1200),0);
  assert.equal(acceptChat(game,{user:{userId:'2'},comment:'apple'},31000),0);
  startRound(game, {answer:'absurd',band:'C1'},32000,30);
  assert.equal(acceptChat(game,{user:{userId:'1'},comment:'absurd'},33000),50);
  assert.equal(game.players['1'].score,60);
});
test('gift streaks award only cumulative increments and deduplicate replay', () => {
  const game=createGame();
  const gift={user:{userId:'1',nickname:'A'},giftId:5655,groupId:'g',giftDetails:{diamondCount:2,giftType:1},repeatCount:1,msgId:'a'};
  assert.equal(acceptGift(game,gift,5),10);
  assert.equal(acceptGift(game,gift,5),0);
  assert.equal(acceptGift(game,{...gift,repeatCount:3,msgId:'b'},5),20);
  assert.equal(acceptGift(game,{...gift,repeatCount:3,repeatEnd:true,msgId:'c'},5),0);
  assert.equal(game.players['1'].giftScore,30);
  assert.equal(acceptGift(game,{...gift,groupId:'next',msgId:'d'},5),10);
});
test('gift coin values award ten points per coin by default', () => {
  const game=createGame();
  assert.equal(acceptGift(game,{userId:'a',msgId:'rose',gift:{name:'Rose',coinCount:1}}),10);
  assert.equal(acceptGift(game,{userId:'a',msgId:'coins',coinCount:3,repeatCount:2}),60);
  assert.equal(acceptGift(game,{userId:'a',msgId:'details',giftDetails:{coinCount:2}}),20);
  assert.equal(acceptGift(game,{userId:'a',msgId:'legacy',gift:{diamondCount:1}}),10);
  assert.equal(game.players.a.score,100);
  assert.equal(game.players.a.giftScore,100);
});
test('coin gift streaks credit only new gifts and reject unknown or invalid values', () => {
  const game=createGame();
  const gift={userId:'a',giftId:'rose',groupId:'streak',gift:{name:'Rose',coinCount:1},repeatCount:1};
  assert.equal(acceptGift(game,gift),10);
  assert.equal(acceptGift(game,{...gift,repeatCount:3}),20);
  assert.equal(acceptGift(game,{...gift,repeatCount:3,repeatEnd:true}),0);
  assert.equal(acceptGift(game,gift),0);
  for(const coinCount of [0,-1,1.5,Infinity])
    assert.equal(acceptGift(game,{userId:'a',msgId:`invalid-${coinCount}`,coinCount}),0);
  assert.equal(acceptGift(game,{userId:'a',msgId:'unknown',gift:{name:'Unknown'}}),0);
  assert.equal(game.players.a.giftScore,30);
});
test('malformed or unidentifiable gifts and comments cannot score', () => {
  const game=createGame();
  for(const gift of [{}, {userId:'a',diamondCount:-2}, {userId:'a',diamondCount:2,repeatCount:Infinity}, {userId:'a',diamondCount:2}]) assert.equal(acceptGift(game,gift),0);
  assert.equal(acceptChat(game,{comment:'apple'}),0);
  assert.equal(acceptGift(game,{userId:'a',msgId:'x',diamondCount:3}),30);
});
test('native v3 gift uses nested gift and common message ID', () => {
  const game=createGame(); const data={user:{id:'native',nickname:'Native'},common:{msgId:'v3'},gift:{id:'gift',diamondCount:7,type:0,name:'Gift'},repeatCount:1};
  assert.equal(acceptGift(game,data,5),35);
  assert.equal(acceptGift(game,data,5),0);
  assert.equal(game.players.native.name,'Native');
});
test('revealed rounds reject answers and separate users can score', () => {
  const game=createGame();startRound(game,{answer:'apologize',aliases:['apologise'],band:'B1'},1000,30);
  assert.equal(acceptChat(game,{userId:'a',comment:'apologise'},1001),30);
  assert.equal(acceptChat(game,{userId:'b',comment:'apologize'},1002),30);
  game.round.revealed=true;
  assert.equal(acceptChat(game,{userId:'c',comment:'apologize'},1003),0);
});

test('substrings and accented aliases count, empty answers do not', () => {
  const game=createGame(); startRound(game,{answer:'apple',band:'A1'},1000);
  assert.equal(acceptChat(game,{userId:'a',comment:'pineapple'},1001),10);
  startRound(game,{answer:'đỏ',aliases:['red'],band:'A1'},1000);
  assert.equal(acceptChat(game,{userId:'b',comment:'màu DO nhé'},1001),10);
  startRound(game,{answer:'',aliases:[''],band:'A1'},1000);
  assert.equal(acceptChat(game,{userId:'c',comment:'anything'},1001),0);
});
test('storage restores scores, gift deduplication, deck and a paused round', () => {
  const storage={value:null,setItem(key,value){assert.equal(key,STORAGE_KEY);this.value=value;},getItem(){return this.value;}};
  const game=createGame(); startRound(game,{answer:'apple',band:'A1'},1000);
  acceptChat(game,{userId:'a',comment:'apple'},1001);
  const gift={userId:'a',msgId:'gift',diamondCount:5}; acceptGift(game,gift);
  game.deck={remaining:['red'],cycle:2,last:'apple'};
  assert.equal(saveGame(storage,game),true);
  const restored=restoreGame(storage);
  assert.deepEqual({...restored.players.a},{...game.players.a});
  assert.deepEqual(restored.deck,game.deck);
  assert.deepEqual(restored.round.answered,['a']);
  assert.equal(restored.round.revealed,true);
  assert.equal(acceptGift(restored,gift),0);
  saveGame(storage,createGame());
  assert.equal(Object.keys(restoreGame(storage).players).length,0);
});
test('missing, corrupt or unavailable storage safely falls back', () => {
  for(const value of [null,'broken','{}','{"players":[],"gifts":{},"deck":{}}']) {
    assert.deepEqual(restoreGame({getItem:()=>value}),createGame());
  }
  const storage={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  assert.deepEqual(restoreGame(storage),createGame());
  assert.equal(saveGame(storage,createGame()),false);
});


test('avatars from chat and native gifts persist and refresh without losing scores', () => {
  const game=createGame(); startRound(game,{answer:'apple',band:'A1'},1000);
  acceptChat(game,{user:{userId:'a',nickname:'An',profilePictureUrl:'https://example.com/a.jpg'},comment:'apple'},1001);
  assert.equal(game.players.a.avatar,'https://example.com/a.jpg');
  acceptGift(game,{user:{id:'a',nickname:'An mới',avatarThumb:{urlList:['https://example.com/b.jpg']}},gift:{diamondCount:2},common:{msgId:'g'}});
  assert.equal(game.players.a.avatar,'https://example.com/b.jpg');
  assert.equal(game.players.a.name,'An mới');
  assert.equal(game.players.a.score,30);
  acceptGift(game,{userId:'a',msgId:'g2',diamondCount:1,profilePictureUrl:'javascript:alert(1)'});
  assert.equal(game.players.a.avatar,'https://example.com/b.jpg');
  const storage={setItem(k,v){this.value=v;},getItem(){return this.value;}};
  saveGame(storage,game);
  assert.equal(restoreGame(storage).players.a.avatar,'https://example.com/b.jpg');
});

test('admin preview leaves the question open, deadline and next schedule unchanged', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  const game=createGame(); startRound(game,{answer:'apple',band:'A1'},1000);
  const state=runInNewContext(script+`; game.value=fixture; running.value=true; nextAt=456; toggleAnswerPreview(); ({preview:answerPreview.value,game:game.value,running:running.value,nextAt});`,{
    ref:value=>({value}),computed:get=>({get value(){return get();}}),createGame,POINTS,WORDS,fixture:game,
    onMounted:()=>{},onBeforeUnmount:()=>{},watch:()=>{},
  });
  assert.equal(state.preview,true);
  assert.equal(state.game.round.revealed,false);
  assert.equal(state.game.round.deadline,31000);
  assert.equal(state.running,true);
  assert.equal(state.nextAt,456);
  assert.equal(acceptChat(game,{userId:'viewer',comment:'apple'},2000),10);
  const arena=source.split('<section ref="screen"')[1].split('</section>')[0];
  assert.doesNotMatch(arena,/@click="(?:toggleAnswerPreview|next)"/);
});


test('starting defaults to fresh scores and only restores when explicitly checked', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  const old=createGame(); acceptGift(old,{userId:'old',msgId:'old-gift',diamondCount:900});
  const storage={value:JSON.stringify(old),getItem(){return this.value;},setItem(k,v){this.value=v;}};
  const context={ref:value=>({value}),computed:get=>({get value(){return get();}}),createGame,POINTS,WORDS,
    startRound,drawWord,restoreGame,saveGame,window:{localStorage:storage},
    onMounted:()=>{},onBeforeUnmount:()=>{},watch:()=>{},};
  const fresh=runInNewContext(script+`; const initial=Object.keys(game.value.players).length; const checked=loadPrevious.value; startQuiz(); ({initial,checked,game:game.value,running:running.value});`,{...context});
  assert.equal(fresh.initial,0);
  assert.equal(fresh.checked,false);
  assert.equal(Object.keys(fresh.game.players).length,0);
  assert.equal(fresh.running,true);
  assert.equal(Object.keys(JSON.parse(storage.value).players).length,0);
  storage.value=JSON.stringify(old);
  const resumed=runInNewContext(script+`; loadPrevious.value=true; startQuiz(); game.value;`,{...context});
  assert.equal(resumed.players.old.score,9000);
  assert.equal(resumed.round.revealed,false);
  const unavailable=runInNewContext(script+`; loadPrevious.value=true; startQuiz(); game.value;`,{...context,window:{get localStorage(){throw Error('blocked');}}});
  assert.equal(Object.keys(unavailable.players).length,0);
  assert.ok(unavailable.round);
  assert.match(source,/@click="startQuiz"/);
});


test('member arrivals stay on one line without displacing comments and gifts', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  const state=runInNewContext(script+`; ({recordActivity,interactionActivity,participantActivity,connect});`,{
    ref:value=>({value}),computed:get=>({get value(){return get();}}),createGame,POINTS,WORDS,
    parseLiveUrl:()=>{},EventSource:class {addEventListener(){} close(){}},
    onMounted:()=>{},onBeforeUnmount:()=>{},watch:()=>{},
  });
  state.recordActivity('chat',{nickname:'An',comment:'hello'});
  state.recordActivity('gift',{nickname:'Bình',giftName:'Rose'});
  for(let i=0;i<10;i++) state.recordActivity('member',{nickname:`Khách ${i}`});
  assert.equal(state.interactionActivity.value.length,2);
  assert.match(state.interactionActivity.value[0].text,/Rose/);
  assert.match(state.interactionActivity.value[1].text,/hello/);
  assert.match(state.participantActivity.value.text,/Khách 9/);
  for(let i=0;i<4;i++) state.recordActivity('chat',{comment:`comment ${i}`});
  assert.equal(state.interactionActivity.value.length,3);
  assert.match(state.interactionActivity.value[0].text,/comment 3/);
  state.connect();
  assert.equal(state.interactionActivity.value.length,0);
  assert.equal(state.participantActivity.value,null);
});
