// Общий каркас страницы: шапка, навигация, подвал, модалка добавления аккаунта.
import { html } from './html.mjs';

const NAV = [
  { href: '/', label: 'Обзор', key: 'dashboard' },
  { href: '/accounts', label: 'Аккаунты', key: 'accounts' },
  { href: '/compare', label: 'Сравнение', key: 'compare' },
  { href: '/videos', label: 'Ролики', key: 'videos' },
  { href: '/help', label: 'Как это работает', key: 'help' },
];

// «Доступ» показывается только владельцу в режиме с входом: наблюдателю там
// нечего делать, а в локальном запуске пользователей нет вовсе.
const ACCESS_NAV = { href: '/access', label: 'Доступ', key: 'access' };

export function layout({
  title, active = '', body, mode = 'demo', providerReason = '', description = '', chrome = true,
  user = null, nav = [], csrf = '',
}) {
  const items = [...NAV, ...nav];
  return html`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Creator Analytics</title>
  <meta name="description" content="${description || 'Аналитика контента креаторов: статистика и разбор содержания роликов из Instagram, YouTube и TikTok.'}">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/manrope-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles/app.css">
  <script type="module" src="/js/app.js"></script>
</head>
<body>
  <div class="shell">
    ${chrome ? html`<header class="topbar">
      <div class="topbar__inner">
        <a class="brand" href="/">
          <span class="brand__mark" aria-hidden="true">CA</span>
          <span class="brand__text">Creator Analytics<small>аналитика контента</small></span>
        </a>
        <nav class="nav" aria-label="Основная навигация">
          ${items.map((item) => (item.key === active
            ? html`<a class="nav__link" href="${item.href}" aria-current="page">${item.label}</a>`
            : html`<a class="nav__link" href="${item.href}">${item.label}</a>`))}
        </nav>
        ${user
          ? html`<span class="topbar__user" title="${user.email}">
              ${user.name || user.email}
              <form method="post" action="/logout" class="topbar__logout">
                <input type="hidden" name="_csrf" value="${csrf}">
                <button class="btn btn--ghost btn--small" type="submit">Выйти</button>
              </form>
            </span>`
          : ''}
        ${mode === 'demo'
          ? html`<span class="mode-badge mode-badge--demo" title="${providerReason}"><span class="mode-badge__dot"></span>демо-данные</span>`
          : html`<span class="mode-badge" title="${providerReason}"><span class="mode-badge__dot" style="background:var(--good)"></span>живые данные</span>`}
      </div>
    </header>` : ''}
    <main class="main" id="main">${body}</main>
    ${chrome ? html`<footer class="footer">
      <div class="footer__inner">
        <span>Creator Analytics — открытый сервис аналитики контента. Работает локально, данные не покидают ваш сервер.</span>
        <span>Данные платформ — публичная статистика на момент синхронизации.</span>
      </div>
    </footer>` : ''}
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <dialog class="modal" id="add-account-dialog" aria-labelledby="add-account-title">
    <form method="dialog" id="add-account-form" novalidate>
      <div class="modal__head">
        <div>
          <h2 id="add-account-title">Добавить аккаунт</h2>
          <p class="card__hint" style="margin-top:4px">Вставьте ссылку на профиль или @ник. Платформа определится сама.</p>
        </div>
        <button class="icon-btn" value="cancel" aria-label="Закрыть" type="submit" formnovalidate>✕</button>
      </div>
      <div class="modal__body">
        <div class="field">
          <label class="field__label" for="account-input">Ссылка или @ник</label>
          <input class="input" id="account-input" name="account" type="text" autocomplete="off" spellcheck="false"
                 placeholder="https://www.instagram.com/username или @username" required>
          <span class="field__hint" id="account-input-hint">Instagram, YouTube, TikTok — публичные профили.</span>
        </div>
        <div class="field">
          <label class="field__label" for="account-notes">Заметка <span class="field__hint">(необязательно)</span></label>
          <textarea class="textarea" id="account-notes" name="notes" maxlength="300" placeholder="Например: клиент, кампания «Осень»"></textarea>
        </div>
        <div class="field">
          <label class="field__label" for="platform-hint">Платформа <span class="field__hint">(если в ссылке не указана)</span></label>
          <select class="select" id="platform-hint" name="platform">
            <option value="">Определить автоматически</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
          </select>
        </div>
        <div id="add-account-error" class="notice notice--error" hidden></div>
      </div>
      <div class="modal__foot">
        <button class="btn btn--ghost" value="cancel" type="submit">Отмена</button>
        <button class="btn btn--primary" value="submit" type="submit" id="add-account-submit">Добавить и загрузить</button>
      </div>
    </form>
  </dialog>
</body>
</html>`;
}
