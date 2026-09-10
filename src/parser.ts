export type Category = 'FOOD' | 'SHOPPING' | 'TRANSPORT' | 'BILLS' | 'OTHER';
export type TimeSource = 'EXPLICIT' | 'MESSAGE_DATE' | 'DEFAULT_NOW';

export interface ParsedTransaction {
  id: number;
  description: string;
  amount: number;
  currency: 'THB';
  category: Category;
  occurredAt: string;
  timeSource: TimeSource;
  confidence: number;
  warnings: string[];
}

export interface ParseResult {
  input: string;
  transactions: ParsedTransaction[];
  warnings: string[];
  needsReview: boolean;
}

interface ParseOptions {
  now?: Date;
}

const CATEGORY_RULES: Array<{ category: Category; terms: string[] }> = [
  { category: 'FOOD', terms: ['ข้าว', 'อาหาร', 'น้ำเปล่า', 'น้ำ', 'กาแฟ', 'ชา', 'ก๋วยเตี๋ยว'] },
  { category: 'SHOPPING', terms: ['ช้อปปิ้ง', 'ช้อป', 'ซื้อของ', 'เสื้อ', 'รองเท้า'] },
  { category: 'TRANSPORT', terms: ['แท็กซี่', 'รถไฟ', 'รถเมล์', 'grab', 'bolt', 'น้ำมัน'] },
  { category: 'BILLS', terms: ['ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'ค่าโทรศัพท์', 'บิล'] },
];

function cleanDescription(value: string): string {
  return value
    .trim()
    .replace(/^(?:(?:แล้วก็|แล้ว|และ|กับ|[,;])\s*)+/u, '')
    .trim();
}

function inferCategory(description: string): { category: Category; certain: boolean } {
  const lower = description.toLocaleLowerCase('th');
  let best: { category: Category; termLength: number } | null = null;

  for (const rule of CATEGORY_RULES) {
    for (const term of rule.terms) {
      if (lower.includes(term) && (!best || term.length > best.termLength)) {
        best = { category: rule.category, termLength: term.length };
      }
    }
  }

  return best ? { category: best.category, certain: true } : { category: 'OTHER', certain: false };
}

function bangkokDateParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour'), minute: pick('minute'), second: pick('second') };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatBangkokParts(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}+07:00`;
}

function shiftBangkokDate(parts: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function extractTime(text: string, now: Date): { remaining: string; occurredAt: string; source: TimeSource; warnings: string[] } {
  const nowParts = bangkokDateParts(now);
  let remaining = text;
  let date = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  let source: TimeSource = 'DEFAULT_NOW';
  const warnings: string[] = [];

  const dateMarkers = [...remaining.matchAll(/เมื่อวาน|วันนี้/gu)];
  if (dateMarkers.length > 0) {
    if (dateMarkers[0][0] === 'เมื่อวาน') date = shiftBangkokDate(date, -1);
    remaining = remaining.replace(/เมื่อวาน|วันนี้/gu, ' ');
    source = 'MESSAGE_DATE';
    if (dateMarkers.length > 1) warnings.push('multiple_time_expressions');
  }

  const supportedClockPattern = /(?<!\d)(?:ตอน\s*)?5\s*โมง\s*(ครึ่ง)?/gu;
  const supportedClocks = [...remaining.matchAll(supportedClockPattern)];
  let explicitTime: { hour: number; minute: number } | null = null;
  if (supportedClocks.length > 0) {
    explicitTime = { hour: 17, minute: supportedClocks[0][1] ? 30 : 0 };
    remaining = remaining.replace(supportedClockPattern, ' ');
    source = 'EXPLICIT';
    if (supportedClocks.length > 1 && !warnings.includes('multiple_time_expressions')) warnings.push('multiple_time_expressions');
  }

  const thaiNumberWord = '(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)';
  const unsupportedTimePatterns = [
    /(?<!\d)(?:ตอน\s*)?\d+\s*โมง\s*(?:ครึ่ง)?(?!\d)/gu,
    /(?<!\d)(?:ตอน\s*)?\d{1,2}:\d{2}(?!\d)/gu,
    new RegExp(`(?:บ่าย|ตี)\\s*(?:${thaiNumberWord}|\\d+)`, 'gu'),
    new RegExp(`(?:${thaiNumberWord}|\\d+)\\s*ทุ่ม`, 'gu'),
  ];
  for (const pattern of unsupportedTimePatterns) {
    if (pattern.test(remaining)) {
      remaining = remaining.replace(pattern, ' ');
      if (!warnings.includes('time_expression_unrecognized')) warnings.push('time_expression_unrecognized');
    }
  }

  if (explicitTime) {
    return {
      remaining,
      occurredAt: formatBangkokParts({ ...date, hour: explicitTime.hour, minute: explicitTime.minute, second: 0 }),
      source,
      warnings,
    };
  }

  if (source === 'MESSAGE_DATE') {
    return {
      remaining,
      occurredAt: formatBangkokParts({ ...date, hour: nowParts.hour, minute: nowParts.minute, second: nowParts.second }),
      source,
      warnings,
    };
  }

  return { remaining, occurredAt: formatBangkokParts(nowParts), source, warnings };
}

export function parseMessage(text: string, options: ParseOptions = {}): ParseResult {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const input = text.trim();
  if (!input) throw new TypeError('text must not be blank');

  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date');

  const time = extractTime(input, now);
  // A Thai connector may be typed immediately after an amount (e.g. `50กับ...`).
  // Insert only a parsing boundary after a digit so the next candidate starts at the
  // connector instead of one code point into it; do not split connectors inside descriptions.
  const parseText = time.remaining.replace(/(?<=\d)(?=แล้วก็|แล้ว|และ|กับ)/gu, ' ');
  const transactions: ParsedTransaction[] = [];
  const matchedSpans: Array<[number, number]> = [];
  let hasOutOfRangeAmount = false;
  const pattern = /(?<![\d.+-])([^0-9+-]+?)\s*(?<!\.)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*บาท)?(?=\s|[,;!?]|\.(?!\d)|แล้วก็|แล้ว|และ|กับ|$)/gu;

  for (const match of parseText.matchAll(pattern)) {
    const description = cleanDescription(match[1]);
    if (!description) continue;
    const amount = Number(match[2].replaceAll(',', ''));
    if (match.index !== undefined) matchedSpans.push([match.index, match.index + match[0].length]);
    if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER) {
      hasOutOfRangeAmount = true;
      continue;
    }

    const category = inferCategory(description);
    const warnings: string[] = [];
    if (!category.certain) warnings.push('category_uncertain');
    if (amount <= 0) warnings.push('non_positive_amount');
    const confidence = Math.max(0.4, 0.98 - (category.certain ? 0 : 0.22) - (amount <= 0 ? 0.3 : 0));

    transactions.push({
      id: transactions.length + 1,
      description,
      amount,
      currency: 'THB',
      category: category.category,
      occurredAt: time.occurredAt,
      timeSource: time.source,
      confidence: Number(confidence.toFixed(2)),
      warnings,
    });
  }

  const warnings: string[] = [...time.warnings];
  if (hasOutOfRangeAmount) warnings.push('amount_out_of_range');
  if (transactions.length === 0) {
    if (!hasOutOfRangeAmount) warnings.push(/\d/u.test(parseText) ? 'transaction_format_unrecognized' : 'no_amount_found');
  } else {
    let unparsed = parseText;
    for (const [start, end] of matchedSpans.toReversed()) {
      unparsed = `${unparsed.slice(0, start)}${' '.repeat(end - start)}${unparsed.slice(end)}`;
    }
    const residual = unparsed
      .replace(/(?:แล้วก็|แล้ว|และ|กับ|บาท)/gu, ' ')
      .replace(/[\s,;.!?…:()\[\]{}"'“”‘’]+/gu, '');
    if (/\d/u.test(residual)) warnings.push('unparsed_numeric_content');
    else if (residual) warnings.push('unparsed_text_content');
  }
  const needsReview = warnings.length > 0 || transactions.some((transaction) => transaction.warnings.length > 0 || transaction.confidence < 0.9);

  return { input, transactions, warnings, needsReview };
}
