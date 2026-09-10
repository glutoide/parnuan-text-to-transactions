import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../src/parser.ts';

const NOW = new Date('2026-09-10T12:00:00+07:00');

test('parses required single transaction', () => {
  const result = parseMessage('ข้าวมันไก่ 50', { now: NOW });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].description, 'ข้าวมันไก่');
  assert.equal(result.transactions[0].amount, 50);
  assert.equal(result.transactions[0].currency, 'THB');
  assert.equal(result.transactions[0].category, 'FOOD');
});

test('parses required multiple transactions in source order', () => {
  const result = parseMessage('ข้าวมันไก่ 50 น้ำเปล่า 7 แล้วก็ช้อปปิ้ง 500', { now: NOW });
  assert.deepEqual(
    result.transactions.map(({ description, amount, category }) => ({ description, amount, category })),
    [
      { description: 'ข้าวมันไก่', amount: 50, category: 'FOOD' },
      { description: 'น้ำเปล่า', amount: 7, category: 'FOOD' },
      { description: 'ช้อปปิ้ง', amount: 500, category: 'SHOPPING' },
    ],
  );
});

test('parses yesterday at 5:30 PM without treating time numbers as amounts', () => {
  const result = parseMessage('เมื่อวานตอน 5 โมงครึ่ง ข้าวมันไก่ 50', { now: NOW });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, 50);
  assert.equal(result.transactions[0].occurredAt, '2026-09-09T17:30:00+07:00');
  assert.equal(result.transactions[0].timeSource, 'EXPLICIT');
});

test('unknown category remains reviewable instead of being guessed', () => {
  const result = parseMessage('ของลึกลับ 120', { now: NOW });
  assert.equal(result.transactions[0].category, 'OTHER');
  assert.ok(result.transactions[0].confidence < 0.9);
  assert.ok(result.transactions[0].warnings.includes('category_uncertain'));
  assert.equal(result.needsReview, true);
});

test('text without an amount returns a warning and no invented transaction', () => {
  const result = parseMessage('ข้าวมันไก่', { now: NOW });
  assert.deepEqual(result.transactions, []);
  assert.ok(result.warnings.includes('no_amount_found'));
  assert.equal(result.needsReview, true);
});

test('rejects blank input', () => {
  assert.throws(() => parseMessage('   ', { now: NOW }), /text must not be blank/);
});

test('parses comma and semicolon separated transactions', () => {
  const result = parseMessage('ข้าวมันไก่ 50, น้ำเปล่า 7; แล้วก็ช้อปปิ้ง 500', { now: NOW });
  assert.deepEqual(
    result.transactions.map(({ description, amount }) => ({ description, amount })),
    [
      { description: 'ข้าวมันไก่', amount: 50 },
      { description: 'น้ำเปล่า', amount: 7 },
      { description: 'ช้อปปิ้ง', amount: 500 },
    ],
  );
});

test('prefers specific bill keyword over generic food substring', () => {
  const result = parseMessage('ค่าน้ำ 300', { now: NOW });
  assert.equal(result.transactions[0].category, 'BILLS');
});

test('prefers specific transport keyword over generic food substring', () => {
  const result = parseMessage('น้ำมัน 1200', { now: NOW });
  assert.equal(result.transactions[0].category, 'TRANSPORT');
});

test('does not turn an unsupported Thai time expression into a transaction', () => {
  const result = parseMessage('เมื่อวานตอน 15 โมงครึ่ง ข้าวมันไก่ 50', { now: NOW });
  assert.deepEqual(result.transactions.map(({ description, amount }) => ({ description, amount })), [
    { description: 'ข้าวมันไก่', amount: 50 },
  ]);
  assert.ok(result.warnings.includes('time_expression_unrecognized'));
  assert.equal(result.needsReview, true);
});

test('reports unsupported transaction format when an amount exists without a description', () => {
  const result = parseMessage('50', { now: NOW });
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.warnings, ['transaction_format_unrecognized']);
});

test('does not salvage a suffix of an unsupported decimal as a new transaction', () => {
  const result = parseMessage('ข้าวมันไก่ 12.345', { now: NOW });
  assert.deepEqual(result.transactions, []);
  assert.ok(result.warnings.includes('transaction_format_unrecognized'));
});

test('parses comma-grouped thousands without truncating the amount', () => {
  const whole = parseMessage('กาแฟ 1,200', { now: NOW });
  assert.equal(whole.transactions.length, 1);
  assert.equal(whole.transactions[0].amount, 1200);

  const decimal = parseMessage('ข้าว 1,234.56', { now: NOW });
  assert.equal(decimal.transactions.length, 1);
  assert.equal(decimal.transactions[0].amount, 1234.56);
});

test('preserves a negative sign instead of silently turning it into a positive expense', () => {
  const result = parseMessage('ข้าว -50', { now: NOW });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, -50);
  assert.ok(result.transactions[0].warnings.includes('non_positive_amount'));
  assert.equal(result.needsReview, true);
});

test('does not turn colon-style clock digits into transactions', () => {
  const result = parseMessage('เมื่อวานตอน 15:30 ข้าว 50', { now: NOW });
  assert.deepEqual(result.transactions.map(({ description, amount }) => ({ description, amount })), [
    { description: 'ข้าว', amount: 50 },
  ]);
  assert.ok(result.warnings.includes('time_expression_unrecognized'));
  assert.equal(result.needsReview, true);
});

test('removes the full unsupported Thai clock number instead of leaving numeric residue', () => {
  const result = parseMessage('เมื่อวานตอน 115 โมงครึ่ง ข้าว 50', { now: NOW });
  assert.deepEqual(result.transactions.map(({ description, amount }) => ({ description, amount })), [
    { description: 'ข้าว', amount: 50 },
  ]);
  assert.ok(result.warnings.includes('time_expression_unrecognized'));
});

test('surfaces leftover numeric content instead of silently dropping it', () => {
  const result = parseMessage('ข้าว 50 999', { now: NOW });
  assert.equal(result.transactions[0].amount, 50);
  assert.ok(result.warnings.includes('unparsed_numeric_content'));
  assert.equal(result.needsReview, true);
});

test('surfaces leftover text content instead of silently dropping it', () => {
  const result = parseMessage('ข้าว 50 น้ำ', { now: NOW });
  assert.equal(result.transactions[0].amount, 50);
  assert.ok(result.warnings.includes('unparsed_text_content'));
  assert.equal(result.needsReview, true);
});

test('does not treat a normal baht suffix as unexplained leftover text', () => {
  const result = parseMessage('ข้าว 50 บาท', { now: NOW });
  assert.equal(result.transactions[0].amount, 50);
  assert.ok(!result.warnings.includes('unparsed_text_content'));
});

test('accepts a baht suffix with or without whitespace', () => {
  for (const text of ['ข้าว 50บาท', 'ข้าว 50 บาท']) {
    const result = parseMessage(text, { now: NOW });
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].amount, 50);
    assert.deepEqual(result.warnings, []);
  }
});

test('accepts ordinary sentence punctuation after an amount', () => {
  for (const text of ['ข้าว 50.', 'ข้าว 50!', 'ข้าว 50?']) {
    const result = parseMessage(text, { now: NOW });
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].amount, 50);
    assert.deepEqual(result.warnings, []);
  }
});

test('surfaces multiple date expressions instead of silently mixing them into descriptions', () => {
  const result = parseMessage('เมื่อวาน ข้าว 50 วันนี้ น้ำ 20', { now: NOW });
  assert.deepEqual(result.transactions.map(({ description, amount }) => ({ description, amount })), [
    { description: 'ข้าว', amount: 50 },
    { description: 'น้ำ', amount: 20 },
  ]);
  assert.ok(result.warnings.includes('multiple_time_expressions'));
  assert.equal(result.needsReview, true);
});

test('parses a baht suffix immediately followed by a Thai connector', () => {
  const result = parseMessage('ของ 50บาทแล้วก็ข้าว 20', { now: NOW });
  assert.deepEqual(result.transactions.map(({ description, amount }) => ({ description, amount })), [
    { description: 'ของ', amount: 50 },
    { description: 'ข้าว', amount: 20 },
  ]);
  assert.ok(!result.warnings.includes('unparsed_numeric_content'));
});

test('surfaces amounts outside the safe numeric range instead of emitting non-finite or imprecise values', () => {
  for (const text of [`ข้าว ${'9'.repeat(400)}`, 'ข้าว 999999999999999999999999']) {
    const result = parseMessage(text, { now: NOW });
    assert.deepEqual(result.transactions, []);
    assert.ok(result.warnings.includes('amount_out_of_range'));
    assert.equal(result.needsReview, true);
  }
});

test('parses Thai กับ connector even when users omit surrounding spaces', () => {
  const result = parseMessage('ข้าว 50กับน้ำ 20', { now: NOW });
  assert.deepEqual(result.transactions.map(({ description, amount }) => ({ description, amount })), [
    { description: 'ข้าว', amount: 50 },
    { description: 'น้ำ', amount: 20 },
  ]);
  assert.deepEqual(result.warnings, []);
});

test('does not silently reinterpret a leading-dot decimal as a whole-baht amount', () => {
  const result = parseMessage('ข้าว .50', { now: NOW });
  assert.deepEqual(result.transactions, []);
  assert.ok(result.warnings.includes('transaction_format_unrecognized'));
  assert.equal(result.needsReview, true);
});

test('surfaces unsupported Thai time words instead of treating them as confident purchase descriptions', () => {
  for (const text of ['บ่ายสอง ข้าว 50', 'ตีห้า ข้าว 50', 'สองทุ่ม ข้าว 50']) {
    const result = parseMessage(text, { now: NOW });
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].description, 'ข้าว');
    assert.equal(result.transactions[0].amount, 50);
    assert.ok(result.warnings.includes('time_expression_unrecognized'));
    assert.equal(result.needsReview, true);
  }
});
