import { validateLead, maskPhoneInput, normalizePhone } from './lead-validation.mjs';

const RATE_KEY = 'lead-last-submit';
const RATE_MS = 30_000;

function fieldError(form, name, message) {
  const node = form.querySelector(`[data-error-for="${name}"]`);
  if (node) {
    node.textContent = message || '';
    node.hidden = !message;
  }
  const control = form.querySelector(`[data-field="${name}"]`);
  const wrapper = (control || form.querySelector(`[name="${name}"]`))?.closest('.field');
  if (wrapper) wrapper.dataset.invalid = message ? 'true' : 'false';
  if (control) {
    if (message) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }
}

function clearErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((node) => {
    node.textContent = '';
    node.hidden = true;
  });
  form.querySelectorAll('.field').forEach((field) => delete field.dataset.invalid);
  form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
}

function setStatus(form, state, message) {
  const node = form.querySelector('[data-form-status]');
  if (!node) return;
  node.dataset.state = state;
  node.textContent = message;
}

function setBusy(form, busy) {
  const button = form.querySelector('[data-submit]');
  const label = form.querySelector('[data-submit-label]');
  const spinner = form.querySelector('.spinner');
  if (button) button.disabled = busy;
  if (button) button.setAttribute('aria-busy', String(busy));
  if (spinner) spinner.hidden = !busy;
  if (label) label.textContent = busy ? 'Отправляем…' : 'Отправить заявку';
}

function readForm(form) {
  const data = new FormData(form);
  return {
    name: data.get('name') ?? '',
    phone: data.get('phone') ?? '',
    comment: data.get('comment') ?? '',
    contactMethod: data.get('contactMethod') ?? 'call',
    consent: data.get('consent') === 'on',
    website: data.get('website') ?? '',
  };
}

function rateLimited() {
  try {
    const last = Number(localStorage.getItem(RATE_KEY) || 0);
    if (last && Date.now() - last < RATE_MS) {
      return Math.ceil((RATE_MS - (Date.now() - last)) / 1000);
    }
    return 0;
  } catch {
    return 0;
  }
}

function markSent() {
  try {
    localStorage.setItem(RATE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function applyErrors(form, errors) {
  for (const [name, message] of Object.entries(errors)) fieldError(form, name, message);
  const first = form.querySelector('[data-invalid="true"] input, [data-invalid="true"] textarea');
  if (first) first.focus({ preventScroll: false });
}

export function initLeadForm(form, { onSuccess, onError } = {}) {
  if (!form) return;

  const phone = form.querySelector('[data-phone]');
  if (phone) {
    phone.addEventListener('input', () => {
      const masked = maskPhoneInput(phone.value);
      phone.value = masked;
      if (phone.dataset.touched) fieldError(form, 'phone', '');
    });
    phone.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text') ?? '';
      if (!/\d/.test(text)) return;
      event.preventDefault();
      phone.value = maskPhoneInput(text);
      fieldError(form, 'phone', '');
    });
    phone.addEventListener('blur', () => {
      phone.dataset.touched = 'true';
      const value = phone.value.trim();
      if (value && value !== '+7 (' && value.replace(/\D/g, '').length < 11) {
        fieldError(form, 'phone', 'Введите номер полностью — 11 цифр.');
      } else if (value && normalizePhone(value)) {
        fieldError(form, 'phone', '');
      }
    });
    phone.addEventListener('focus', () => {
      if (!phone.value.trim()) phone.value = '+7 (';
    });
  }

  // Проверяем только покинутое поле — иначе ошибка одного поля всплывала бы
  // при уходе из другого.
  form.querySelectorAll('[data-field]').forEach((control) => {
    control.addEventListener('blur', () => {
      if (control.type === 'checkbox') return;
      control.dataset.touched = 'true';
      const name = control.dataset.field;
      const values = readForm(form);
      const result = validateLead({ ...values, consent: true });
      if (result.errors?.[name]) fieldError(form, name, result.errors[name]);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    setStatus(form, '', '');

    const values = readForm(form);
    const result = validateLead(values);
    if (!result.ok) {
      applyErrors(form, result.errors);
      setStatus(form, 'error', 'Проверьте выделенные поля и попробуйте снова.');
      return;
    }

    const wait = rateLimited();
    if (wait) {
      setStatus(form, 'error', `Заявка уже отправлена. Повторить можно через ${wait} с.`);
      return;
    }

    setBusy(form, true);
    try {
      const response = await fetch(form.action || '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...result.values, page: location.pathname }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        if (payload.errors) applyErrors(form, payload.errors);
        throw new Error(payload.message || 'Не удалось отправить заявку.');
      }
      markSent();
      form.reset();
      if (phone) phone.value = '';
      setStatus(form, 'success', payload.message || 'Заявка отправлена, мы свяжемся с вами в течение 15 минут.');
      document.dispatchEvent(new CustomEvent('lead:success', { detail: payload }));
      onSuccess?.(payload);
    } catch (error) {
      setStatus(
        form,
        'error',
        error?.message
          ? `${error.message} Позвоните нам или напишите в мессенджер — примем заявку вручную.`
          : 'Не удалось отправить заявку. Позвоните нам или напишите в мессенджер.',
      );
      document.dispatchEvent(new CustomEvent('lead:error', { detail: { message: String(error?.message || error) } }));
      onError?.(error);
    } finally {
      setBusy(form, false);
    }
  });

  const consentField = form.querySelector('[data-field="consent"]');
  consentField?.addEventListener('change', () => fieldError(form, 'consent', ''));
}
