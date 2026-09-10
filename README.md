# Parnuan Text → Transaction(s) — Take-Home Assignment 1

A small proof of concept for turning free-form Thai financial messages into structured, reviewable transactions before confirmation.

The scope is intentionally narrow: a transparent rule-based parser, a tiny Node.js API, and an editable browser review screen. There is no database, runtime LLM call, framework, or external service.

## 1. Reverse-engineered behavior

The supplied assignment frames the existing screenshots as behavioral evidence rather than a pixel specification. From the described product flow and required examples, I infer this core contract:

- the user starts with one free-form financial message;
- one message may become one or several transaction candidates;
- a date/time phrase can affect the candidate timestamp;
- parsing creates a **draft**, not an immediately persisted transaction;
- each candidate should remain inspectable and editable before confirmation;
- uncertainty should stay visible instead of being hidden behind a confident guess.

I intentionally do not reproduce visual styling or infer unrelated product features such as budgets, accounts, or reporting because they are outside this assignment's text → transaction review flow.

## 2. Assumptions

- Currency defaults to **THB** because the required examples and product context are Thai.
- This POC models **expense logging** only. Income/refund/transfer direction is a deliberate next step.
- If no explicit date/time is recognized, `occurredAt` uses the current Bangkok time.
- `เมื่อวาน` means the previous Bangkok calendar day; `วันนี้` means the current Bangkok day.
- For the required phrase `5 โมงครึ่ง`, I interpret the time as **17:30**. Thai colloquial time is context-sensitive, so I treat this as a narrow documented assumption rather than a complete Thai time grammar.
- A single recognized message-level time applies to all candidates in that message. Multiple time/date expressions are surfaced for review instead of silently assigning per-item times.
- Category `OTHER` is valid but carries `category_uncertain` and lower confidence.
- Confirmation validates and returns the reviewed payload; it does not persist it.

## 3. Technical design

The POC has three small parts:

1. **Pure parser (`src/parser.ts`)** — extracts time context and description/amount groups, applies category heuristics, and emits confidence/warnings.
2. **Review validation + HTTP API (`src/review.ts`, `src/server.ts`)** — validates user-edited fields and exposes `/api/parse` and `/api/confirm`.
3. **Vanilla review UI (`public/`)** — lets the user load any required demo, parse it, edit description/amount/category/time, inspect warnings, and confirm the reviewed result.

The parser is deterministic and side-effect free. The HTTP layer is stateless. This keeps the behavior easy to reason about and test while still demonstrating an actual product flow rather than JSON-only sample output.

### Review flow

1. Enter free-form text or choose one of the three required demo messages.
2. Click **Parse message**.
3. Inspect every candidate; confidence and warnings remain visible.
4. Edit description, amount, category, or RFC 3339 timestamp directly in the card.
5. Any edit invalidates a previous confirmation; changing the source message invalidates the parsed result and disables confirmation until the message is parsed again.
6. Click **Confirm reviewed transactions**.
7. `/api/confirm` rejects blank descriptions, non-positive/non-finite amounts, amounts outside the safe integer range, amounts with more than two decimal places, invalid categories/currency, duplicate or unsafe ids, and timestamps that are not RFC 3339 date-times with an explicit timezone.
8. A valid confirmation is returned and shown as JSON. Nothing is persisted.

## 4. Parsing approach

I chose **rules + dictionary heuristics**, not an LLM, for this 1–3 hour POC.

Flow:

1. Trim and validate the input.
2. Detect supported message-level date/time markers before looking for money, so clock digits are not mistaken for transaction amounts.
3. Remove unsupported clock-like spans such as `15:30` or unsupported `…โมง…` forms from money segmentation and emit `time_expression_unrecognized`.
4. Extract repeated `description amount` groups in source order. The amount grammar supports signs, up to two decimals, comma-grouped thousands, optional `บาท` (with or without a space), ordinary punctuation, and common Thai connectors such as `แล้วก็`.
5. Reject unsafe numeric magnitudes as `amount_out_of_range` rather than emitting `Infinity` or a silently imprecise large integer.
6. Map transparent keywords to `FOOD`, `SHOPPING`, `TRANSPORT`, `BILLS`, or `OTHER`. If keywords overlap, the longest/more-specific match wins (`ค่าน้ำ` beats generic `น้ำ`; `น้ำมัน` maps to transport).
7. Attach candidate warnings for unknown categories or non-positive amounts.
8. After extracting valid candidates, inspect all unmatched residue. Leftover digits become `unparsed_numeric_content`; leftover nontrivial text becomes `unparsed_text_content` instead of being silently discarded.
9. If no safe candidate can be produced, distinguish “no numeric amount found” from “numeric content exists but the transaction format is unsupported.”

Why not an LLM: the assignment's mandatory cases are narrow; deterministic rules are free, reproducible, and explainable. For production, a hybrid fallback on unresolved spans would be a better next step than expanding this regex grammar indefinitely.

## 5. Data model

Each parsed candidate contains:

| Field | Meaning |
| --- | --- |
| `id` | 1-based candidate id within the message |
| `description` | Text associated with the amount |
| `amount` | Numeric THB amount |
| `currency` | `THB` in this POC |
| `category` | `FOOD`, `SHOPPING`, `TRANSPORT`, `BILLS`, or `OTHER` |
| `occurredAt` | RFC 3339 date-time with timezone |
| `timeSource` | `EXPLICIT`, `MESSAGE_DATE`, or `DEFAULT_NOW` |
| `confidence` | Transparent heuristic score from 0–1 |
| `warnings` | Candidate-level uncertainty flags |

The top-level parse result also contains the original `input`, message-level `warnings`, and `needsReview`.

## 6. Trade-offs

Optimized for:

- **clarity over coverage** — every rule is visible and deterministic;
- **reviewability over false precision** — unsupported or partially parsed content is surfaced with warnings;
- **zero runtime cost over language flexibility** — no external model/API key is required;
- **small scope over framework architecture** — built-in Node HTTP and a vanilla UI are enough for the proof of concept;
- **runtime simplicity over build tooling** — Node 22's type-stripping runs the small TypeScript source directly, so there is no transpilation dependency. The trade-off is requiring Node 22.6+; `npm run check` is a syntax check rather than a standalone `tsc` semantic type-check.

The principal cost is narrower natural-language coverage than a hybrid/LLM parser. For this assignment, I prefer an explicit limitation and a review flag over pretending broad language understanding.

## 7. Edge cases

Handled deliberately:

- blank input → HTTP 400 / parser rejection;
- no amount → no invented transaction + `no_amount_found`;
- amount-only or unsupported numeric grammar → `transaction_format_unrecognized`;
- unknown category → `OTHER` + `category_uncertain` + lower confidence;
- negative/zero parsed amount → candidate remains visible with `non_positive_amount`, but confirmation rejects it;
- standard comma-grouped amounts such as `1,200` and `1,234.56` are parsed as single values;
- unsafe huge numeric values → `amount_out_of_range`, never `Infinity`/`null` over JSON;
- leftover numeric/text content after otherwise valid candidates → explicit top-level warning;
- overlapping category keywords prefer the most specific match;
- unsupported clock-like expressions are removed from money parsing and surfaced as `time_expression_unrecognized`;
- multiple date/time markers are surfaced as `multiple_time_expressions` rather than silently mixed into descriptions;
- malformed JSON and oversized requests are rejected; confirmation validates edited data independently of the parser, including safe magnitude and two-decimal money precision.

## 8. Known limitations

Realistic cases that still fail or require review:

1. **Broader Thai time language** — `บ่ายสอง`, `ตีห้า`, date ranges, or vague phrases such as “last weekend” are not implemented.
2. **Different amount grammar** — amount-first text (`50 ข้าวมันไก่`), spelled-out numbers, currency symbols, discounts, totals, and arithmetic are outside the grammar.
3. **Descriptions containing meaningful digits** — names such as `7-Eleven` can conflict with numeric segmentation; the parser surfaces unmatched numeric residue rather than claiming a clean parse.
4. **Per-item temporal references** — the POC models time primarily at message level; multiple time expressions trigger review instead of full temporal assignment.
5. **Income/refunds/transfers** are not modeled; transaction direction is absent.
6. **Category coverage** is intentionally tiny and not personalized.
7. **Money representation** uses JavaScript `number`; unsafe integer magnitudes and more-than-two-decimal edited amounts are rejected, but a production accounting system should use fixed-point minor units or a decimal type.
8. There is **no persistence, authentication, authorization, or multi-user state** because the requested deliverable is a local proof of concept.

### What I would improve with one more week

First, create a small anonymized evaluation set of real Thai messages and measure segmentation, temporal, and category errors. Then add a hybrid parser: retain high-confidence deterministic extraction, send only unresolved spans to an LLM, schema-validate the model output, and keep the current review/warning layer. I would next expand Thai temporal parsing and model transaction direction (`expense` / `income` / `transfer`).

## 9. Setup instructions

Requirements:

- Node.js **22.6+** (audited with Node `22.16.0`)
- npm
- no application dependencies, API keys, database, or external services

Clean install:

```bash
npm ci
```

Run syntax checks:

```bash
npm run check
```

Run automated tests:

```bash
npm test
```

Start the POC:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

HTTP parse example:

```bash
curl -s http://127.0.0.1:3000/api/parse \
  -H 'content-type: application/json' \
  -d '{"text":"ข้าวมันไก่ 50 น้ำเปล่า 7 แล้วก็ช้อปปิ้ง 500"}'
```

HTTP confirmation example:

```bash
curl -s http://127.0.0.1:3000/api/confirm \
  -H 'content-type: application/json' \
  -d '{"transactions":[{"id":1,"description":"ข้าวมันไก่พิเศษ","amount":60,"currency":"THB","category":"FOOD","occurredAt":"2026-09-09T17:30:00+07:00"}]}'
```

The UI contains buttons for all three required cases:

```text
ข้าวมันไก่ 50
ข้าวมันไก่ 50 น้ำเปล่า 7 แล้วก็ช้อปปิ้ง 500
เมื่อวานตอน 5 โมงครึ่ง ข้าวมันไก่ 50
```

## 10. Time spent

Approximately **1–2 hours of AI-assisted wall-clock execution** across implementation, regression fixes, and independent audit passes. I kept the product scope aligned with the assignment's 1–3 hour guideline rather than using automation speed to add unrelated architecture.

AI assistance was used to implement and audit the take-home. The running POC itself uses **no LLM**, so it has no model secret or per-request model cost. If an LLM fallback were added later, I would provide its key through environment variables, schema-validate output, and retain deterministic fallback/review behavior.
