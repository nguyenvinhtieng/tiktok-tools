import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as quiz from '../utils/quiz.mjs';
import {WORDS} from '../utils/quiz-words.mjs';
const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
function fixture() {
  let clock=1000, receive;
  const frames=[], writes=[], watchers=[];
  class Clock extends Date { static now(){return clock;} }
  const state=runInNewContext(script+`; speechEnabled.value=false; sessionStarted=true;
    startRound(game.value,{answer:'apple',band:'A1'},1000,30); running.value=true; connect();
    ({game,questionReadAt,interactionActivity,resultsOpen,reveal,finishResults});`,{
    ...quiz, WORDS, Date:Clock,
    ref:value=>({value}),computed:get=>({get value(){return get();}}),
    watch:(target,fn,options)=>watchers.push({target,fn,options}),
    onMounted:fn=>fn(),onBeforeUnmount(){},document:{addEventListener(){}},
    setInterval(){},setTimeout(){return 1;},clearTimeout(){},
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},
    EventSource:class {addEventListener(type,fn){receive=fn;}close(){}},parseLiveUrl(){},
    window:{localStorage:{setItem(k,v){writes.push(v);}}},
  });
  const send=(type,data,receivedAt)=>receive({data:JSON.stringify({type,data,...(receivedAt===undefined?{}:{receivedAt:new Date(receivedAt).toISOString()})})});
  send('connected',{},6000);
  return {state,frames,writes,watchers,clock:v=>{clock=v;},send};
}
test('thousands of wrong chats cannot evict a correct answer; display flushes once per frame',()=>{
  const f=fixture(); f.clock(2000);
  for(let i=0;i<5000;i++) f.send('chat',{userId:`wrong-${i}`,comment:'banana'},7000);
  f.send('chat',{userId:'correct',comment:'apple'},7000);
  for(let i=0;i<5000;i++) f.send('chat',{userId:`more-${i}`,comment:'banana'},7000);
  assert.equal(f.state.game.value.round.results.length,1);
  assert.equal(f.state.game.value.round.results[0].id,'correct');
  assert.equal(f.frames.length,1);
  f.frames.shift()(); assert.equal(f.state.interactionActivity.value.length,10);
  assert.equal(f.writes.length,0);
  assert.equal(f.watchers.find(w=>w.target===f.state.game).options.flush,'post');
});
test('server receipt survives delayed browser processing and clock skew during results',()=>{
  const f=fixture(); f.clock(33000); f.state.reveal(false);
  f.send('chat',{userId:'on-time',comment:'apple'},35000); // local receipt 30000, deadline 31000
  assert.equal(f.state.game.value.round.results[0]?.id,'on-time');
  f.send('chat',{userId:'late',comment:'apple'},37000);
  assert.equal(f.state.game.value.round.results.length,1);
  f.state.finishResults(); assert.equal(f.state.game.value.players['on-time'].correct,1);
  f.send('chat',{userId:'after-settlement',comment:'apple'},35000);
  assert.equal(f.state.game.value.round.results.length,1);
});
test('answers during question reading are accepted with nonnegative elapsed time',()=>{
  const f=fixture(); f.state.questionReadAt.value=1000; f.clock(40000);
  f.send('chat',{userId:'during-reading',comment:'apple'},45000);
  assert.equal(f.state.game.value.round.results[0]?.id,'during-reading');
  assert.equal(f.state.game.value.round.results[0].elapsed,0);
});
test('old-round timestamps and comments after a manual reveal cannot score',()=>{
  const f=fixture(); f.clock(2000);
  f.send('chat',{userId:'previous',comment:'apple'},5500);
  assert.equal(f.state.game.value.round.results.length,0);
  f.state.reveal(false); f.clock(3000);
  f.send('chat',{userId:'after-reveal',comment:'apple'},7500);
  assert.equal(f.state.game.value.round.results.length,0);
});
test('fastest correct answer earns 50 percent bonus once and settlement includes it',()=>{
  const f=fixture(); f.clock(2000);
  f.send('chat',{userId:'first',comment:'apple'},7000);
  f.send('chat',{userId:'first',comment:'apple'},7000);
  f.send('chat',{userId:'second',comment:'apple'},7000);
  const results=f.state.game.value.round.results;
  assert.equal(results.length,2);
  assert.equal(results[0].points,15); assert.equal(results[0].bonus,5);
  assert.equal(results[1].points,10); assert.equal(results[1].bonus,0);
  f.state.reveal(false); f.state.finishResults(); f.state.finishResults();
  assert.equal(f.state.game.value.players.first.score,15);
  assert.equal(f.state.game.value.players.second.score,10);
});
test('an earlier server receipt arriving later takes the bonus; fractions round down',()=>{
  const f=fixture(); f.clock(15000);
  f.send('chat',{userId:'later',comment:'apple'},19000);
  assert.equal(f.state.game.value.round.results[0].points,4); // 3 base + 1 bonus
  f.send('chat',{userId:'earlier',comment:'apple'},18000);
  const results=f.state.game.value.round.results;
  assert.equal(results[0].points,3); assert.equal(results[0].bonus,0);
  assert.equal(results[1].points,4); assert.equal(results[1].bonus,1);
});
