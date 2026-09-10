import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('review UI exposes parse, editable transaction review, and confirm flow', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /id="message"/);
  assert.match(html, /id="parse-button"/);
  assert.match(html, /data-demo="single"/);
  assert.match(html, /data-demo="multiple"/);
  assert.match(html, /data-demo="time"/);
  assert.match(html, /id="transactions"/);
  assert.match(html, /id="confirm-button"/);

  assert.match(js, /\/api\/parse/);
  assert.match(js, /\/api\/confirm/);
  assert.match(js, /description/);
  assert.match(js, /amount/);
  assert.match(js, /category/);
  assert.match(js, /occurredAt/);
  assert.match(js, /confidence/);
  assert.match(js, /warnings/);
});

test('parse failure clears stale review and confirmation state', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const catchBlock = js.match(/parseButton\.addEventListener[\s\S]*?catch \(error\) \{([\s\S]*?)\n  \} finally/);
  assert.ok(catchBlock, 'parse error handler should exist');
  assert.match(catchBlock[1], /messageWarnings\.replaceChildren\(\)/);
  assert.match(catchBlock[1], /reviewBadge\.textContent = 'Parse failed'/);
  assert.match(catchBlock[1], /confirmedOutput\.textContent = 'Nothing confirmed yet\.'/);
});

test('editing a rendered candidate invalidates any previous confirmation', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(js, /transactions\.addEventListener\('input', invalidateConfirmation\)/);
  assert.match(js, /function invalidateConfirmation\(event\)/);
  assert.match(js, /closest\('\.transaction-card'\)/);
  assert.match(js, /reviewBadge\.textContent = 'Edited — confirm again'/);
  assert.match(js, /confirmedOutput\.textContent = 'Nothing confirmed yet\.'/);
});

test('changing source text invalidates stale parsed candidates until re-parse', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(js, /message\.addEventListener\('input', invalidateParsedResult\)/);
  const invalidation = js.match(/function invalidateParsedResult\(\) \{([\s\S]*?)\n\}/);
  assert.ok(invalidation, 'input invalidation handler should exist');
  assert.doesNotMatch(invalidation[1], /querySelector\('\.transaction-card'\)/);
  assert.match(js, /confirmButton\.disabled = true/);
  assert.match(js, /reviewBadge\.textContent = 'Input changed — parse again'/);
  assert.match(js, /confirmedOutput\.textContent = 'Nothing confirmed yet\.'/);
  assert.match(js, /button\.addEventListener\('click',[\s\S]*?invalidateParsedResult\(\)/);
});
