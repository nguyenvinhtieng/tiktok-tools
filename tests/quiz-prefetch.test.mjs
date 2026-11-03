import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as quiz from '../utils/quiz.mjs';
import { WORDS } from '../utils/quiz-words.mjs';

async function fixture() {
  const source = await readFile(new URL('../components/EnglishQuiz.vue', import.meta.url), 'utf8');
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  const calls = [], watchers = [];
  const state = runInNewContext(script + `;
    speech={speak:(answer,revealed)=>{calls.push(['speak',answer,revealed]);return Promise.resolve(true);},prefetch:(answer,revealed)=>{calls.push(['prefetch',answer,revealed]);return Promise.resolve(true);},stop(){}};
    speechEnabled.value=true;
    ({game,band,next,prepareSpeech,resultsOpen,reset,startQuiz,speechEnabled,readRound});`, {
    ...quiz, WORDS, calls,
    ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    watch: (target, callback) => watchers.push([target, callback]), onMounted() {}, onBeforeUnmount() {},
    window: { confirm: () => true, localStorage: { setItem() {} } },
  });
  function advance() { state.game.value.round.revealed=true; state.resultsOpen.value=false; state.next(); }
  function changeBand(value) { state.band.value=value; watchers.find(([target])=>target===state.band)[1](); }
  return {state,calls,advance,changeBand};
}

test('round prepares its answer and the exact next question without consuming the deck', async () => {
  const {state,calls,advance}=await fixture();
  state.next();
  assert.equal(calls[0][0],'speak');
  const current=state.game.value.round.word.answer;
  const prepared=calls.filter(call=>call[0]==='prefetch');
  assert.ok(prepared.some(call=>call[1]===current && call[2]===true));
  const upcoming=prepared.find(call=>call[2]===false)[1];
  assert.ok(state.game.value.deck.remaining.includes(upcoming));
  const count=state.game.value.deck.remaining.length;
  advance();
  assert.equal(state.game.value.round.word.answer,upcoming);
  assert.equal(state.game.value.deck.remaining.length,count-1);
});

test('band changes discard reservations without consuming an unused word', async () => {
  const {state,calls,advance,changeBand}=await fixture();
  state.next();
  const upcoming=calls.find(call=>call[0]==='prefetch' && call[2]===false)[1];
  const target=WORDS.find(word=>word.answer===upcoming).band==='A1' ? 'A2' : 'A1';
  changeBand(target);
  assert.ok(state.game.value.deck.remaining.includes(upcoming));
  advance();
  assert.equal(state.game.value.round.word.band,target);
  assert.ok(state.game.value.deck.remaining.includes(upcoming));
});

test('reset discards a reserved word and disabled speech does not prefetch', async () => {
  const {state,calls}=await fixture();
  state.next();
  state.reset();
  state.speechEnabled.value=false;
  calls.length=0;
  state.next();
  assert.equal(calls.length,0);
  assert.equal(state.game.value.deck.cycle,1);
  assert.equal(state.game.value.deck.remaining.length,new Set(WORDS.map(word=>word.answer)).size-1);
});

test('a changed deck invalidates the reservation before starting another round', async () => {
  const {state,calls,advance}=await fixture();
  state.next();
  const upcoming=calls.find(call=>call[0]==='prefetch' && call[2]===false)[1];
  const replacement=WORDS.find(word=>word.answer!==upcoming && word.answer!==state.game.value.round.word.answer);
  state.game.value.deck.remaining=[replacement.answer];
  advance();
  assert.equal(state.game.value.round.word.answer,replacement.answer);
  assert.equal(state.game.value.deck.remaining.length,0);
});

test('starting a new session uses a fresh deck rather than a previous reservation', async () => {
  const {state}=await fixture();
  state.next();
  state.game.value.round.revealed=true;
  state.startQuiz();
  assert.equal(state.game.value.deck.cycle,1);
  assert.equal(state.game.value.deck.remaining.length,new Set(WORDS.map(word=>word.answer)).size-1);
});

test('hints and point steps share the paused question clock, including replay', async () => {
  const source=await readFile(new URL('../components/EnglishQuiz.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  let clock=1000, tick;
  const pending=[];
  class Clock extends Date { static now() { return clock; } }
  const state=runInNewContext(script+`;
    speech={speak:()=>new Promise(resolve=>pending.push(resolve)),stop(){}};
    speechEnabled.value=true;
    startRound(game.value,{answer:'apple',band:'A1'},1000,30,()=>0);
    running.value=true;
    ({readRound,hint,pointSteps,remainingMs});`,{
    ...quiz,WORDS,pending,Date:Clock,
    ref:value=>({value}),computed:get=>({get value(){return get();}}),watch(){},
    onMounted:fn=>fn(),onBeforeUnmount(){},
    document:{addEventListener(){}},setInterval:fn=>{tick=fn;},
  });
  const initialHint=state.hint.value.text;
  const reading=state.readRound();
  clock=21000; tick();
  assert.equal(state.hint.value.divisor,1);
  assert.equal(state.hint.value.text,initialHint);
  assert.equal(state.pointSteps.value[0].state,'now');
  assert.equal(state.remainingMs.value,30000);
  pending.shift()(true); await reading;
  assert.equal(state.hint.value.divisor,1);
  assert.equal(state.hint.value.text,initialHint);
  clock=31000; tick();
  assert.equal(state.hint.value.divisor,2);
  assert.equal(state.pointSteps.value[1].state,'now');
  const replayHint=state.hint.value.text;
  const replay=state.readRound();
  clock=41000; tick();
  assert.equal(state.hint.value.divisor,2);
  assert.equal(state.hint.value.text,replayHint);
  assert.equal(state.remainingMs.value,20000);
  pending.shift()(true); await replay;
  assert.equal(state.hint.value.divisor,2);
  assert.equal(state.hint.value.text,replayHint);
  clock=43000; tick();
  assert.equal(state.hint.value.divisor,3);
  assert.equal(state.pointSteps.value[2].state,'now');
});
