import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, drawWord } from '../utils/quiz.mjs';
import { WORDS } from '../utils/quiz-words.mjs';

const fixture = [
  { answer: 'apple', vi: 'quả táo', band: 'A1' },
  { answer: 'bread', vi: 'bánh mì', band: 'A1' },
  { answer: 'ability', vi: 'khả năng', band: 'A2' },
  { answer: 'admire', vi: 'ngưỡng mộ', band: 'B1' },
  { answer: 'absorb', vi: 'hấp thụ', band: 'B2' },
  { answer: 'abolish', vi: 'bãi bỏ', band: 'C1' },
  { answer: 'ephemeral', vi: 'phù du', band: 'C2' },
];

test('draw removes each answer until the entire deck is exhausted', () => {
  const game = createGame();
  const answers = new Set();
  for (let i = 0; i < fixture.length; i++) {
    const word = drawWord(game, fixture, 'mixed', () => 0);
    assert.ok(word);
    assert.ok(!answers.has(word.answer), `Repeated ${word.answer} before exhaustion`);
    answers.add(word.answer);
    assert.equal(game.deck.cycle, 1);
    assert.equal(game.deck.remaining.length, fixture.length - i - 1);
    assert.ok(!game.deck.remaining.includes(word.answer));
  }
  assert.equal(answers.size, fixture.length);
  assert.equal(fixture.length, 7, 'Drawing must not mutate the source array');
});

test('changing band preserves exclusions and does not reset an exhausted band', () => {
  const game = createGame();
  const first = drawWord(game, fixture, 'A1', () => 0);
  const second = drawWord(game, fixture, 'A1', () => 0);
  assert.equal(first.band, 'A1');
  assert.equal(second.band, 'A1');
  assert.notEqual(first.answer, second.answer);
  const before = [...game.deck.remaining];
  assert.equal(drawWord(game, fixture, 'A1', () => 0), null);
  assert.deepEqual(game.deck.remaining, before);
  assert.equal(game.deck.cycle, 1);
  const third = drawWord(game, fixture, 'B1', () => 0);
  assert.equal(third.band, 'B1');
  const remaining = [];
  while (game.deck.remaining.length) remaining.push(drawWord(game, fixture, 'mixed', () => 0).answer);
  assert.ok(!remaining.includes(first.answer));
  assert.ok(!remaining.includes(second.answer));
  assert.ok(!remaining.includes(third.answer));
});

test('full depletion refills the deck for the next cycle', () => {
  const game = createGame();
  for (let i = 0; i < fixture.length; i++) drawWord(game, fixture, 'mixed', () => 0);
  const next = drawWord(game, fixture, 'mixed', () => 0);
  assert.ok(fixture.some(word => word.answer === next.answer));
  assert.equal(game.deck.cycle, 2);
  assert.equal(game.deck.remaining.length, fixture.length - 1);
  for (let i = 1; i < fixture.length; i++) drawWord(game, fixture, 'mixed', () => 0);
  drawWord(game, fixture, 'mixed', () => 0);
  assert.equal(game.deck.cycle, 3);
});

test('cycle boundary avoids the last answer when another eligible word exists', () => {
  const game = createGame();
  const words = fixture.filter(word => word.band === 'A1');
  drawWord(game, words, 'A1', () => 0);
  const last = drawWord(game, words, 'A1', () => 0);
  const next = drawWord(game, words, 'A1', () => 0.999999);
  assert.notEqual(next.answer, last.answer);
  assert.equal(game.deck.cycle, 2);
  assert.equal(drawWord(game, words, 'A1', () => 0).answer, last.answer);
});

test('a new game starts a fresh deck without retaining another game exclusions', () => {
  const first = createGame();
  const answer = drawWord(first, fixture, 'mixed', () => 0).answer;
  const second = createGame();
  assert.equal(drawWord(second, fixture, 'mixed', () => 0).answer, answer);
  assert.equal(second.deck.cycle, 1);
  drawWord(first, fixture, 'mixed', () => 0);
  assert.equal(second.deck.remaining.length, fixture.length - 1);
});

test('initial mixed draws prioritize A2 through C1', () => {
  let preferred = 0;
  for (let i = 0; i < 1000; i++) {
    const word = drawWord(createGame(), fixture, 'mixed', () => i / 1000);
    if (['A2', 'B1', 'B2', 'C1'].includes(word.band)) preferred++;
  }
  assert.ok(preferred > 900, `${preferred}/1000 preferred-band draws`);
});

test('empty word lists and unavailable bands return null safely', () => {
  assert.equal(drawWord(createGame(), [], 'mixed', () => 0), null);
  const game = createGame();
  const words = fixture.filter(word => word.band === 'A1');
  assert.equal(drawWord(game, words, 'C1', () => 0), null);
  assert.ok(drawWord(game, words, 'A1', () => 0));
});

test('the full vocabulary can be drawn once each, then reused after reset', () => {
  const game = createGame();
  const expected = new Set(WORDS.map(word => word.answer));
  const seen = new Set();
  for (let i = 0; i < expected.size; i++) {
    const word = drawWord(game, WORDS, 'mixed', () => 0.5);
    assert.ok(word);
    assert.ok(!seen.has(word.answer), `Repeated ${word.answer}`);
    seen.add(word.answer);
  }
  assert.deepEqual(seen, expected);
  assert.equal(game.deck.remaining.length, 0);
  assert.ok(drawWord(game, WORDS, 'mixed', () => 0.5));
  assert.equal(game.deck.cycle, 2);
});
