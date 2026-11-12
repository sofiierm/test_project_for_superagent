import { site, nav } from '../content/site.mjs';
import { icon } from '../lib/icons.mjs';
import { escapeHtml } from '../lib/html.mjs';
import { formMarkup } from './_form.mjs';

const THEME_INIT = `(function(){try{var s=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)');var t=s==='dark'||s==='light'?s:(m.matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var c=document.querySelector('meta[name=theme-color]');}catch(e){}})();`;

export function head({ canonical, title, description, ogImage, jsonLd = [], styles = ['/assets/css/site.css'], scripts = [] }) {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>${THEME_INIT}</script>
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="theme-color" content="#f7f4ef" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#14110e" media="(prefers-color-scheme: dark)">
  <meta name="format-detection" content="telephone=no">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:site_name" content="${escapeHtml(site.brand)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Гостиная с мебелью мастерской «${escapeHtml(site.brand)}»">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preload" href="/assets/fonts/manrope-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/cormorant-garamond-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  ${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n  ')}
  ${jsonLd.map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join('\n  ')}
  ${scripts.map((src) => `<script src="${src}" defer></script>`).join('\n  ')}`;
}

export function header() {
  return `<header class="header" data-header>
  <div class="container header__inner">
    <a class="logo" href="#top" aria-label="${escapeHtml(site.brand)} — на главную">
      <span class="logo__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 26V9l11-5 11 5v17"/><path d="M11 26v-9h10v9"/><path d="M5 26h22"/>
        </svg>
      </span>
      <span class="logo__text"><span class="logo__name">${escapeHtml(site.brand)}</span><span class="logo__tag">${escapeHtml(site.brandTagline)}</span></span>
    </a>

    <nav class="nav" id="primary-nav" aria-label="Основная навигация" data-nav>
      <ul class="nav__list">
        ${nav.map((item) => `<li><a class="nav__link" href="#${item.id}" data-nav-link="${item.id}">${escapeHtml(item.label)}</a></li>`).join('')}
      </ul>
      <div class="nav__mobile-actions">
        <a class="btn btn--secondary btn--block" href="${site.phoneHref}" data-track="phone_click" data-place="menu">${icon('phone', { size: 18 })} ${escapeHtml(site.phone)}</a>
        <button type="button" class="btn btn--primary btn--block" data-open-lead>Оставить заявку</button>
      </div>
    </nav>

    <div class="header__actions">
      <a class="header__phone" href="${site.phoneHref}" data-track="phone_click" data-place="header">${escapeHtml(site.phone)}</a>
      <button type="button" class="btn btn--primary header__cta" data-open-lead>
        <span class="header__cta-full">Оставить заявку</span>
        <span class="header__cta-short">Заявка</span>
      </button>
      <button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label="Переключить тему оформления" aria-pressed="false">
        <span class="theme-toggle__icon theme-toggle__icon--sun">${icon('sun', { size: 20 })}</span>
        <span class="theme-toggle__icon theme-toggle__icon--moon">${icon('moon', { size: 20 })}</span>
      </button>
      <button type="button" class="icon-btn burger" aria-expanded="false" aria-controls="primary-nav" aria-label="Открыть меню" data-burger>
        <span class="burger__icon burger__icon--open">${icon('menu', { size: 22 })}</span>
        <span class="burger__icon burger__icon--close">${icon('close', { size: 22 })}</span>
      </button>
    </div>
  </div>
</header>`;
}

export function footer() {
  const year = new Date().getFullYear();
  return `<footer class="footer" id="footer">
  <div class="container footer__grid">
    <div class="footer__brand">
      <a class="logo logo--footer" href="#top" aria-label="${escapeHtml(site.brand)} — наверх">
        <span class="logo__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 26V9l11-5 11 5v17"/><path d="M11 26v-9h10v9"/><path d="M5 26h22"/>
          </svg>
        </span>
        <span class="logo__text"><span class="logo__name">${escapeHtml(site.brand)}</span><span class="logo__tag">${escapeHtml(site.brandTagline)}</span></span>
      </a>
      <p class="footer__desc">Проектируем и производим мебель для квартир и домов в Москве с 2014 года.</p>
      <address class="footer__address">${escapeHtml(site.address)}</address>
    </div>

    <nav class="footer__col" aria-label="Разделы сайта">
      <h2 class="footer__heading">Разделы</h2>
      <ul>
        ${nav.map((item) => `<li><a href="#${item.id}">${escapeHtml(item.label)}</a></li>`).join('')}
      </ul>
    </nav>

    <div class="footer__col">
      <h2 class="footer__heading">Контакты</h2>
      <ul>
        <li><a href="${site.phoneHref}" data-track="phone_click" data-place="footer">${escapeHtml(site.phone)}</a></li>
        <li><a href="mailto:${site.email}">${escapeHtml(site.email)}</a></li>
        <li><a href="${site.whatsapp}" target="_blank" rel="noopener" data-track="messenger_click" data-place="footer">WhatsApp</a></li>
        <li><a href="${site.telegram}" target="_blank" rel="noopener" data-track="messenger_click" data-place="footer">Telegram</a></li>
        <li><span>${escapeHtml(site.hours)}</span></li>
      </ul>
    </div>

    <div class="footer__col footer__col--legal">
      <h2 class="footer__heading">Документы</h2>
      <ul>
        <li><a href="/privacy.html">Политика конфиденциальности</a></li>
        <li><a href="/privacy.html#consent">Согласие на обработку данных</a></li>
        <li><a href="/credits.html">Использованные изображения</a></li>
        <li><button type="button" class="linklike" data-cookie-settings>Настройки cookie</button></li>
      </ul>
      <p class="footer__requisites">${escapeHtml(site.legalName)}<br>ИНН ${site.inn} · ОГРН ${site.ogrn}</p>
    </div>
  </div>
  <div class="container footer__bottom">
    <p>© 2014–${year} ${escapeHtml(site.brand)}. Все права защищены.</p>
    <p class="footer__note">Цены и сроки на сайте не являются публичной офертой. Стоимость рассчитывается после замера.</p>
  </div>
</footer>`;
}

export function overlays() {
  return `<div class="modal" id="lead-modal-dialog" data-modal hidden>
  <div class="modal__backdrop" data-modal-close></div>
  <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title" tabindex="-1">
    <button type="button" class="icon-btn modal__close" aria-label="Закрыть окно заявки" data-modal-close>${icon('close', { size: 22 })}</button>
    ${formMarkup({ id: 'lead-modal', heading: 'Оставить заявку', compact: true }).replace(
      '<h3 class="lead-form__title">',
      '<h2 class="lead-form__title" id="lead-modal-title">',
    ).replace('</h3>', '</h2>')}
  </div>
</div>

<div class="lightbox" id="lightbox" data-lightbox-root hidden>
  <div class="lightbox__backdrop" data-lightbox-close></div>
  <div class="lightbox__dialog" role="dialog" aria-modal="true" aria-labelledby="lightbox-title" tabindex="-1">
    <button type="button" class="icon-btn lightbox__close" aria-label="Закрыть просмотр" data-lightbox-close>${icon('close', { size: 22 })}</button>
    <figure class="lightbox__figure">
      <div class="lightbox__media" data-lightbox-media></div>
      <figcaption>
        <h2 id="lightbox-title" data-lightbox-title></h2>
        <p data-lightbox-details></p>
        <p class="lightbox__term" data-lightbox-term></p>
      </figcaption>
    </figure>
  </div>
</div>

<button type="button" class="to-top" data-to-top aria-label="Наверх" hidden>${icon('arrowUp', { size: 20 })}</button>

<a class="call-fab" href="${site.phoneHref}" data-track="phone_click" data-place="fab" aria-label="Позвонить по номеру ${escapeHtml(site.phone)}">${icon('phone', { size: 22 })}</a>

<aside class="cookie" id="cookie-banner" data-cookie-banner hidden aria-labelledby="cookie-title">
  <div class="cookie__text">
    <h2 id="cookie-title">Cookie и аналитика</h2>
    <p>Аналитические cookie помогают понять, какие блоки полезны. Они включаются только с вашего согласия — на работу сайта это не влияет. <a href="/privacy.html#cookies">Подробнее</a></p>
  </div>
  <div class="cookie__actions">
    <button type="button" class="btn btn--primary" data-cookie-accept>Принять</button>
    <button type="button" class="btn btn--secondary" data-cookie-decline>Только необходимые</button>
  </div>
</aside>

<div class="toast" role="status" aria-live="polite" data-toast hidden></div>`;
}
