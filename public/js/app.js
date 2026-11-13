// Клиентская часть: только интерактив, без которого интерфейс не работает.
// Всё остальное отрисовано на сервере — страница полезна и без JS.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const toast = $('#toast');
let toastTimer = null;

function showToast(message, kind = 'ok') {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('toast--error', kind === 'error');
  toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.dataset.visible = 'false'; }, 5000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!response.ok) {
    const error = new Error(payload.error || `Ошибка ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

// ---------- Модалка добавления аккаунта ----------

const dialog = $('#add-account-dialog');
const form = $('#add-account-form');
const input = $('#account-input');
const errorBox = $('#add-account-error');
const submitBtn = $('#add-account-submit');

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openDialog() {
  if (!dialog) return;
  errorBox.hidden = true;
  input.removeAttribute('aria-invalid');
  dialog.showModal();
  // Фокус ставим сразу, а не в requestAnimationFrame: в кадре между
  // showModal() и колбэком фокус формально остаётся на кнопке-триггере, и
  // любой, кто проверит activeElement (тест, скринридер, клавиатура), увидит
  // модалку без фокуса. showModal делает поле фокусируемым синхронно.
  input?.focus();
}

// Нативный <dialog> закрывает клавиатуру внутри себя не во всех браузерах:
// Tab уходил в адресную строку, и фокус терялся. Держим цикл сами.
dialog?.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const items = [...dialog.querySelectorAll(FOCUSABLE)]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  // Если фокус уже потерян (ушёл в chrome браузера) — возвращаем в диалог.
  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
});

$$('[data-open-add-account]').forEach((btn) => btn.addEventListener('click', openDialog));

dialog?.addEventListener('close', () => {
  errorBox.hidden = true;
  form?.reset();
});

form?.addEventListener('submit', async (event) => {
  // Кнопки «Отмена» и «Закрыть» имеют value=cancel и просто закрывают диалог.
  const submitter = event.submitter;
  if (submitter?.value === 'cancel') return;

  event.preventDefault();
  const account = input.value.trim();
  if (!account) {
    showFormError('Укажите ссылку на профиль или @ник.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Загружаю…';
  errorBox.hidden = true;

  try {
    const payload = await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        account,
        platform: $('#platform-hint')?.value || undefined,
        notes: $('#account-notes')?.value || '',
      }),
    });
    dialog.close();
    const warning = payload.warning ? ' ' + payload.warning : '';
    showToast(`Аккаунт @${payload.account.handle} добавлен, роликов: ${payload.videosFound}.${warning}`, payload.warning ? 'info' : 'ok');
    setTimeout(() => { window.location.href = `/accounts/${payload.account.id}`; }, 600);
  } catch (error) {
    const hint = error.payload?.hint ? ` ${error.payload.hint}` : '';
    showFormError(`${error.message}${hint}`);
    if (error.payload?.accountId) {
      setTimeout(() => { window.location.href = `/accounts/${error.payload.accountId}`; }, 900);
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Добавить и загрузить';
  }
});

function showFormError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

// ---------- Отчёт ----------

// «Скачать отчёт» открывает системный диалог печати: оттуда пользователь
// сохраняет PDF. Отдельная генерация PDF на сервере потребовала бы
// runtime-зависимость, а печатная версия уже свёрстана (@media print).
$$('[data-print-report]').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Рассказываем, что произойдёт: кнопка «скачать» без файла иначе выглядит
    // сломанной, если браузер не открыл диалог мгновенно.
    showToast('Открываю печать: выберите «Сохранить как PDF», чтобы получить файл.', 'info');
    // Даём тосту отрисоваться до блокирующего диалога печати.
    setTimeout(() => window.print(), 150);
  });
});

// ---------- Действия с аккаунтами ----------

$$('[data-sync-account]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.syncAccount;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Синхронизирую…';
    try {
      const result = await api(`/api/accounts/${id}/sync`, { method: 'POST' });
      if (result.status === 'error') {
        showToast(result.error || 'Не удалось синхронизировать аккаунт.', 'error');
      } else {
        showToast(`Готово: найдено ${result.videosFound}, новых ${result.videosNew}.${result.warning ? ' ' + result.warning : ''}`, result.warning ? 'info' : 'ok');
        setTimeout(() => window.location.reload(), 900);
      }
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
});

$$('[data-delete-account]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.deleteAccount;
    const handle = btn.dataset.handle;
    if (!window.confirm(`Удалить аккаунт @${handle} вместе со всеми роликами и метриками?`)) return;
    btn.disabled = true;
    try {
      await api(`/api/accounts/${id}`, { method: 'DELETE' });
      showToast(`Аккаунт @${handle} удалён.`);
      setTimeout(() => { window.location.href = '/accounts'; }, 500);
    } catch (error) {
      showToast(error.message, 'error');
      btn.disabled = false;
    }
  });
});

// Открытие модалки по ссылке ?add=1 — удобно для закладок и тестов.
if (new URLSearchParams(window.location.search).get('add') === '1') openDialog();
