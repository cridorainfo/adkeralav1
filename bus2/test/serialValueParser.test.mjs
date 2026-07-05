import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialValueParser } from '../src/lib/serialValueParser.js';

test('emits digit stream values once per change', () => {
  const values = [];
  const parser = createSerialValueParser((v) => values.push(v));

  parser.feed('1');
  parser.feed('1');
  assert.deepEqual(values, ['1']);

  parser.feed('0');
  assert.deepEqual(values, ['1', '0']);

  parser.feed('2');
  assert.deepEqual(values, ['1', '0', '2']);
});

test('newline-delimited lines are parsed', () => {
  const values = [];
  const parser = createSerialValueParser((v) => values.push(v));

  parser.feed('1\n');
  parser.feed('0\n');
  parser.feed('3\n');
  assert.deepEqual(values, ['1', '0', '3']);
});

test('repeat newline-delimited presses emit each time', () => {
  const values = [];
  const parser = createSerialValueParser((v) => values.push(v));

  parser.feed('1\n');
  parser.feed('1\n');
  assert.deepEqual(values, ['1', '1']);
});

test('text commands fullscreen and exit emit on token', () => {
  const values = [];
  const parser = createSerialValueParser((v) => values.push(v), {
    textCommands: ['fullscreen', 'exit'],
  });

  parser.feed('fullscreen');
  assert.deepEqual(values, ['fullscreen']);

  parser.feed('exit');
  assert.equal(values.at(-1), 'exit');
});

test('reset clears parser state', () => {
  const values = [];
  const parser = createSerialValueParser((v) => values.push(v));

  parser.feed('1');
  parser.reset();
  parser.feed('1');
  assert.deepEqual(values, ['1', '1']);
});
