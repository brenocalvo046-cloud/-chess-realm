import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';

test('posição inicial tem vinte jogadas legais', () => {
  const chess = new Chess();
  assert.equal(chess.moves().length, 20);
});

test('movimentos válidos atualizam a posição e o histórico', () => {
  const chess = new Chess();
  chess.move('e4'); chess.move('e5'); chess.move('Nf3');
  assert.equal(chess.history().join(' '), 'e4 e5 Nf3');
  assert.equal(chess.turn(), 'b');
});

test('movimentos ilegais são rejeitados', () => {
  const chess = new Chess();
  assert.throws(() => chess.move('e5'));
  assert.equal(chess.history().length, 0);
});

test('detecta xeque-mate', () => {
  const chess = new Chess();
  for (const move of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(move);
  assert.equal(chess.isCheckmate(), true);
});
