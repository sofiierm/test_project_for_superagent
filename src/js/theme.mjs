/**
 * Тема оформления: тёмная и светлая. Выбор хранится в localStorage, по
 * умолчанию берётся системная настройка. Ранний инлайн-скрипт в <head> уже
 * выставил атрибут до первой отрисовки, здесь мы только синхронизируем UI.
 */
const STORAGE_KEY = 'theme';
const root = document.documentElement;

export function currentTheme() {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

function apply(theme, { persist }) {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* приватный режим — тема останется на текущую сессию */
    }
  }
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
    btn.setAttribute('title', theme === 'dark' ? 'Светлая тема' : 'Тёмная тема');
  });
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#14110e' : '#f7f4ef');
}

export function initTheme() {
  apply(currentTheme(), { persist: false });

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      apply(next, { persist: true });
      document.dispatchEvent(new CustomEvent('theme:change', { detail: { theme: next } }));
    });
  });

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === 'dark' || stored === 'light') return;
    apply(event.matches ? 'dark' : 'light', { persist: false });
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  else if (typeof media.addListener === 'function') media.addListener(onChange);
}
