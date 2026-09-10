const demos = {
  single: 'ข้าวมันไก่ 50',
  multiple: 'ข้าวมันไก่ 50 น้ำเปล่า 7 แล้วก็ช้อปปิ้ง 500',
  time: 'เมื่อวานตอน 5 โมงครึ่ง ข้าวมันไก่ 50',
};

const categories = ['FOOD', 'SHOPPING', 'TRANSPORT', 'BILLS', 'OTHER'];
const message = document.querySelector('#message');
const parseButton = document.querySelector('#parse-button');
const confirmButton = document.querySelector('#confirm-button');
const transactions = document.querySelector('#transactions');
const messageWarnings = document.querySelector('#message-warnings');
const requestStatus = document.querySelector('#request-status');
const reviewBadge = document.querySelector('#review-badge');
const confirmedOutput = document.querySelector('#confirmed-output');

function invalidateParsedResult() {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'Input changed. Parse again to review current candidates.';
  transactions.replaceChildren(empty);
  messageWarnings.replaceChildren();
  requestStatus.textContent = 'Input changed. Parse again.';
  reviewBadge.textContent = 'Input changed — parse again';
  reviewBadge.dataset.state = 'warning';
  confirmedOutput.textContent = 'Nothing confirmed yet.';
  confirmButton.disabled = true;
}

message.addEventListener('input', invalidateParsedResult);

for (const button of document.querySelectorAll('[data-demo]')) {
  button.addEventListener('click', () => {
    message.value = demos[button.dataset.demo];
    invalidateParsedResult();
    message.focus();
  });
}

function field(labelText, input) {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = labelText;
  label.append(caption, input);
  return label;
}

function createInput(type, className, value) {
  const input = document.createElement('input');
  input.type = type;
  input.className = className;
  input.value = value;
  return input;
}

function invalidateConfirmation(event) {
  if (!event.target.closest('.transaction-card')) return;
  confirmedOutput.textContent = 'Nothing confirmed yet.';
  reviewBadge.textContent = 'Edited — confirm again';
  reviewBadge.dataset.state = 'warning';
}

transactions.addEventListener('input', invalidateConfirmation);

function render(result) {
  transactions.replaceChildren();
  messageWarnings.replaceChildren();
  confirmedOutput.textContent = 'Nothing confirmed yet.';

  for (const warning of result.warnings) {
    const item = document.createElement('p');
    item.textContent = `Needs review: ${warning}`;
    messageWarnings.append(item);
  }

  if (result.transactions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No transaction could be created safely. Add an amount or clarify the message.';
    transactions.append(empty);
    confirmButton.disabled = true;
    reviewBadge.textContent = 'Needs review';
    reviewBadge.dataset.state = 'warning';
    return;
  }

  for (const transaction of result.transactions) {
    const card = document.createElement('article');
    card.className = 'transaction-card';
    card.dataset.id = String(transaction.id);

    const heading = document.createElement('div');
    heading.className = 'transaction-heading';
    const title = document.createElement('strong');
    title.textContent = `Transaction ${transaction.id}`;
    const confidence = document.createElement('span');
    confidence.className = 'confidence';
    confidence.textContent = `confidence ${Math.round(transaction.confidence * 100)}%`;
    heading.append(title, confidence);

    const description = createInput('text', 'description', transaction.description);
    description.required = true;
    const amount = createInput('number', 'amount', String(transaction.amount));
    amount.min = '0.01';
    amount.step = '0.01';
    amount.required = true;

    const category = document.createElement('select');
    category.className = 'category';
    for (const name of categories) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === transaction.category;
      category.append(option);
    }

    const occurredAt = createInput('text', 'occurredAt', transaction.occurredAt);
    occurredAt.required = true;

    const grid = document.createElement('div');
    grid.className = 'field-grid';
    grid.append(
      field('Description', description),
      field('Amount (THB)', amount),
      field('Category', category),
      field(`Occurred at · ${transaction.timeSource}`, occurredAt),
    );

    const warnings = document.createElement('div');
    warnings.className = 'card-warnings';
    for (const warning of transaction.warnings) {
      const tag = document.createElement('span');
      tag.textContent = warning;
      warnings.append(tag);
    }

    card.append(heading, grid, warnings);
    transactions.append(card);
  }

  confirmButton.disabled = false;
  reviewBadge.textContent = result.needsReview ? 'Needs review' : 'Ready to confirm';
  reviewBadge.dataset.state = result.needsReview ? 'warning' : 'ready';
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

parseButton.addEventListener('click', async () => {
  parseButton.disabled = true;
  requestStatus.textContent = 'Parsing…';
  try {
    const result = await postJson('/api/parse', { text: message.value });
    render(result);
    requestStatus.textContent = `${result.transactions.length} candidate(s)`;
  } catch (error) {
    requestStatus.textContent = error.message;
    transactions.replaceChildren();
    messageWarnings.replaceChildren();
    reviewBadge.textContent = 'Parse failed';
    reviewBadge.dataset.state = 'warning';
    confirmedOutput.textContent = 'Nothing confirmed yet.';
    confirmButton.disabled = true;
  } finally {
    parseButton.disabled = false;
  }
});

confirmButton.addEventListener('click', async () => {
  const reviewed = [...document.querySelectorAll('.transaction-card')].map((card) => ({
    id: Number(card.dataset.id),
    description: card.querySelector('.description').value,
    amount: Number(card.querySelector('.amount').value),
    currency: 'THB',
    category: card.querySelector('.category').value,
    occurredAt: card.querySelector('.occurredAt').value,
  }));

  confirmButton.disabled = true;
  try {
    const result = await postJson('/api/confirm', { transactions: reviewed });
    confirmedOutput.textContent = JSON.stringify(result, null, 2);
    reviewBadge.textContent = 'Confirmed';
    reviewBadge.dataset.state = 'ready';
  } catch (error) {
    confirmedOutput.textContent = `Cannot confirm: ${error.message}`;
  } finally {
    confirmButton.disabled = false;
  }
});
