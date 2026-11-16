// Правила публичной формы обратной связи: без базы и HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMENT_MAX, formatPhone, normalizePhone, validateFeedback,
} from '../../src/services/feedback.mjs';

test('телефон нормализуется из привычных вариантов', () => {
  for (const input of [
    '+7 (999) 123-45-67',
    '8 999 123 45 67',
    '9991234567',
    '+7-999-123-45-67',
    ' 8(999)1234567 ',
  ]) {
    assert.equal(normalizePhone(input), '+79991234567', input);
  }
});

test('некорректный телефон не превращается в догадку', () => {
  for (const input of ['', '123', '+1 202 555 0147', '999 123 45 67 89', 'телефон']) {
    assert.equal(normalizePhone(input), '', input);
  }
});

test('телефон форматируется для чтения человеком', () => {
  assert.equal(formatPhone('+79991234567'), '+7 (999) 123-45-67');
  assert.equal(formatPhone('89991234567'), '+7 (999) 123-45-67');
  assert.equal(formatPhone('123'), '123');
});

test('корректное обращение проходит и сохраняет канонический телефон', () => {
  const result = validateFeedback({
    name: '  Анна   Иванова ', phone: '8 (999) 123-45-67', comment: '  Не открывается отчёт.  ',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.values, {
    name: 'Анна Иванова',
    phone: '+79991234567',
    comment: 'Не открывается отчёт.',
  });
});

test('комментарий необязателен', () => {
  const result = validateFeedback({ name: 'Иван', phone: '+79991234567' });
  assert.equal(result.ok, true);
  assert.equal(result.values.comment, '');
});

test('пустые и мусорные поля дают понятные ошибки, а не 500', () => {
  const result = validateFeedback({ name: '', phone: '', comment: '' });
  assert.equal(result.ok, false);
  assert.match(result.errors.name, /Укажите имя/);
  assert.match(result.errors.phone, /Укажите телефон/);
});

test('в имени допустимы буквы, пробел, дефис и точка', () => {
  assert.equal(validateFeedback({ name: 'Анна-Мария', phone: '+79991234567' }).ok, true);
  assert.equal(validateFeedback({ name: "Д'Артаньян", phone: '+79991234567' }).ok, true);
  assert.equal(validateFeedback({ name: 'Иван 123', phone: '+79991234567' }).ok, false);
});

test('однобуквенное имя и имя из цифр отклоняются', () => {
  assert.equal(validateFeedback({ name: 'Я', phone: '+79991234567' }).ok, false);
  assert.equal(validateFeedback({ name: '12', phone: '+79991234567' }).ok, false);
});

test('длинный комментарий отклоняется с лимитом', () => {
  const result = validateFeedback({
    name: 'Анна', phone: '+79991234567', comment: 'x'.repeat(COMMENT_MAX + 1),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.comment, new RegExp(String(COMMENT_MAX)));
});
