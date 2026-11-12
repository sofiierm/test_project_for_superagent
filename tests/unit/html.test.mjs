// Экранирование HTML: единственная защита от XSS в серверной отрисовке.
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, html, htmlToString, raw } from '../../src/ui/html.mjs';

test('опасные символы экранируются', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('"onmouseover="x'), '&quot;onmouseover=&quot;x');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('интерполяция экранируется по умолчанию', () => {
  const output = htmlToString(html`<p>${'<img src=x onerror=alert(1)>'}</p>`);
  assert.ok(!output.includes('<img'), output);
  assert.ok(output.includes('&lt;img'));
});

test('массив значений склеивается и экранируется', () => {
  const output = htmlToString(html`<ul>${['<a>', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`);
  assert.equal(output, '<ul><li>&lt;a&gt;</li><li>&lt;b&gt;</li></ul>');
});

test('raw вставляет разметку без экранирования — только для доверенных фрагментов', () => {
  assert.equal(htmlToString(html`<div>${raw('<b>ok</b>')}</div>`), '<div><b>ok</b></div>');
});

test('null, undefined и false не попадают в вывод', () => {
  assert.equal(htmlToString(html`<p>${null}${undefined}${false}x</p>`), '<p>x</p>');
});

test('числа и нули выводятся', () => {
  assert.equal(htmlToString(html`<p>${0} ${42}</p>`), '<p>0 42</p>');
});

test('кавычки в атрибутах обезвреживаются', () => {
  const output = htmlToString(html`<a href="${'https://x/"><script>' }">x</a>`);
  assert.ok(!output.includes('"><script>'), output);
});
