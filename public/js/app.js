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

function openDialog() {
  if (!dialog) return;
  errorBox.hidden = true;
  input.removeAttribute('aria-invalid');
  dialog.showModal();
  requestAnimationFrame(() => input?.focus());
}

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
