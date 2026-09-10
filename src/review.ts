import type { Category } from './parser.ts';

export interface ReviewTransaction {
  id: number;
  description: string;
  amount: number;
  currency: 'THB';
  category: Category;
  occurredAt: string;
}

export interface ConfirmationResult {
  status: 'confirmed';
  confirmedAt: string;
  transactions: ReviewTransaction[];
}

const CATEGORIES = new Set<Category>(['FOOD', 'SHOPPING', 'TRANSPORT', 'BILLS', 'OTHER']);

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function isRfc3339Timestamp(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return false;

  if (match[7] !== 'Z') {
    const [offsetHour, offsetMinute] = match[7].slice(1).split(':').map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  return !Number.isNaN(Date.parse(value));
}

export function confirmTransactions(input: unknown, now: Date = new Date()): ConfirmationResult {
  if (!Array.isArray(input) || input.length === 0) throw new TypeError('transactions must be a non-empty array');
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date');

  const seenIds = new Set<number>();
  const transactions = input.map((value, index) => {
    if (typeof value !== 'object' || value === null) throw new TypeError(`transaction ${index + 1} must be an object`);
    const item = value as Record<string, unknown>;
    const id = item.id;
    const description = item.description;
    const amount = item.amount;
    const currency = item.currency;
    const category = item.category;
    const occurredAt = item.occurredAt;

    if (!Number.isSafeInteger(id) || (id as number) <= 0) throw new TypeError(`transaction ${index + 1} id must be a positive safe integer`);
    if (seenIds.has(id as number)) throw new TypeError('transaction ids must be unique');
    seenIds.add(id as number);

    if (typeof description !== 'string' || !description.trim()) throw new TypeError(`transaction ${index + 1} description must not be blank`);
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new TypeError(`transaction ${index + 1} amount must be greater than zero`);
    if (!Number.isSafeInteger(Math.trunc(amount))) throw new TypeError(`transaction ${index + 1} amount must be within the safe integer range`);
    if (!hasAtMostTwoDecimalPlaces(amount)) throw new TypeError(`transaction ${index + 1} amount must use at most two decimal places`);
    if (currency !== 'THB') throw new TypeError(`transaction ${index + 1} currency must be THB`);
    if (typeof category !== 'string' || !CATEGORIES.has(category as Category)) throw new TypeError(`transaction ${index + 1} category is invalid`);
    if (typeof occurredAt !== 'string' || !isRfc3339Timestamp(occurredAt)) throw new TypeError(`transaction ${index + 1} occurredAt must be an RFC 3339 timestamp with timezone`);

    return {
      id: id as number,
      description: description.trim(),
      amount,
      currency: 'THB' as const,
      category: category as Category,
      occurredAt,
    };
  });

  return { status: 'confirmed', confirmedAt: now.toISOString(), transactions };
}
