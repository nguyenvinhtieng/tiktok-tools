import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, SOURCES, VOCABULARY } from '../utils/quiz-words.mjs';
import { POINTS } from '../utils/quiz.mjs';
import vocabulary from '../utils/quiz-vocabulary.json' with { type: 'json' };
test('uploaded PDF dataset has provenance and complete unique entries',()=>{
  assert.equal(VOCABULARY.sourceRows,1760);
  assert.equal(WORDS.length,VOCABULARY.uniqueWords);
  assert.ok(vocabulary.length>=1600);
  assert.equal(new Set(WORDS.map(w=>w.answer)).size,WORDS.length);
  assert.equal(SOURCES.length,1);
  assert.equal(SOURCES[0].url,'/quiz-vocabulary.pdf');
  for(const w of WORDS) {
    assert.ok(w.answer && w.vi && w.pos && w.topic);
    assert.ok(POINTS[w.band]);
    assert.ok(w.page>=4 && w.page<=107);
    assert.ok(!/[\x00-\x1f\ufffd]/.test(w.answer+w.vi));
    assert.match(w.answer,/^[a-z0-9 '’.,&/():+–-]+$/);
    assert.equal(w.levelSource,'estimated');
  }
});
test('multiline cells, ligatures and source meanings stay paired',()=>{
  for(const [answer,vi] of [['staple remover','Cái gỡ ghim bấm'],['scotch tape','Băng dính trong suốt'],['coffee maker','Máy pha cà phê'],['jellyfish','Sứa'],['turn off','Tắt']]) {
    assert.equal(vocabulary.find(w=>w.answer===answer)?.vi,vi);
  }
});
test('playable vocabulary includes only single alphabetic words',()=>{
  assert.deepEqual(WORDS,vocabulary.filter(w=>/^[a-z]+$/i.test(w.answer)));
  assert.ok(WORDS.length>0);
  assert.ok(WORDS.length<vocabulary.length);
  for(const w of WORDS) assert.match(w.answer,/^[a-z]+$/i);
});
