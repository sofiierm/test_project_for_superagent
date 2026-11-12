// Безопасная сборка HTML.
//
// Весь пользовательский контент (названия роликов, описания, ники) приходит
// из внешнего источника и не должен попадать в разметку как код. Поэтому
// единственный способ вставить строку — h(), который экранирует всё; вставка
// «сырого» HTML допускается только для фрагментов, собранных здесь же.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RAW = Symbol('raw-html');

export function raw(html) {
  return { [RAW]: String(html ?? '') };
}

export function isRaw(value) {
  return Boolean(value && typeof value === 'object' && RAW in value);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (isRaw(value)) return value[RAW];
  return escapeHtml(value);
}

/**
 * Шаблонный тег: значения по умолчанию экранируются.
 * html`<p>${userText}</p>` безопасен, html`<p>${raw(trusted)}</p>` — осознанное исключение.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

export function htmlToString(template) {
  return render(template);
}

export { render };
