import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmTransactions } from '../src/review.ts';

const valid = [{
  id: 1,
  description: 'ข้าวมันไก่',
  amount: 50,
  currency: 'THB',
  category: 'FOOD',
  occurredAt: '2026-09-09T17:30:00+07:00',
}];

test('confirms user-reviewed transaction data', () => {
  const result = confirmTransactions(valid, new Date('2026-09-10T12:00:00Z'));
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(result.transactions, valid);
  assert.equal(result.confirmedAt, '2026-09-10T12:00:00.000Z');
});

test('rejects non-positive amount after editing', () => {
  assert.throws(() => confirmTransactions([{ ...valid[0], amount: 0 }]), /amount must be greater than zero/);
});

test('rejects blank description after editing', () => {
  assert.throws(() => confirmTransactions([{ ...valid[0], description: '  ' }]), /description must not be blank/);
});

test('rejects unknown category value', () => {
  assert.throws(() => confirmTransactions([{ ...valid[0], category: 'MAGIC' }]), /category is invalid/);
});

test('rejects invalid timestamp', () => {
  assert.throws(() => confirmTransactions([{ ...valid[0], occurredAt: 'yesterday-ish' }]), /occurredAt must be an RFC 3339 timestamp with timezone/);
});

test('rejects duplicate transaction ids', () => {
  assert.throws(() => confirmTransactions([valid[0], { ...valid[0] }]), /transaction ids must be unique/);
});

test('rejects parseable but non-RFC3339 timestamps without an explicit time zone', () => {
  for (const occurredAt of ['1', '2026', '2026-09-10', '2026-09-10T12:30:00']) {
    assert.throws(
      () => confirmTransactions([{ ...valid[0], occurredAt }]),
      /occurredAt must be an RFC 3339 timestamp with timezone/,
    );
  }
});

test('rejects transaction ids outside the safe integer range', () => {
  assert.throws(
    () => confirmTransactions([{ ...valid[0], id: Number.MAX_SAFE_INTEGER + 1 }]),
    /id must be a positive safe integer/,
  );
});

test('rejects reviewed amounts with more than two decimal places', () => {
  assert.throws(
    () => confirmTransactions([{ ...valid[0], amount: 12.345 }]),
    /amount must use at most two decimal places/,
  );
});

test('rejects reviewed amounts outside the safe integer range', () => {
  assert.throws(
    () => confirmTransactions([{ ...valid[0], amount: Number.MAX_SAFE_INTEGER + 1 }]),
    /amount must be within the safe integer range/,
  );
});
