import { site } from '../content/site.mjs';
import { escapeHtml } from '../lib/html.mjs';

/**
 * Статические служебные страницы: политика конфиденциальности, согласие на
 * обработку данных, титулы изображений и страница 404.
 */
function legalLayout({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>(function(){try{var s=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)');var t=s==='dark'||s==='light'?s:(m.matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})();</script>
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="theme-color" content="#f7f4ef" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#14110e" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="preload" href="/assets/fonts/manrope-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="stylesheet" href="/assets/css/docs.css">
  <script src="/assets/js/main.js" defer></script>
</head>
<body class="doc-page">
  <a class="skip-link" href="#main">Перейти к содержимому</a>
  <header class="doc-header">
    <div class="container doc-header__inner">
      <a class="logo" href="/" aria-label="${escapeHtml(site.brand)} — на главную">
        <span class="logo__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 26V9l11-5 11 5v17"/><path d="M11 26v-9h10v9"/><path d="M5 26h22"/></svg>
        </span>
        <span class="logo__text"><span class="logo__name">${escapeHtml(site.brand)}</span><span class="logo__tag">${escapeHtml(site.brandTagline)}</span></span>
      </a>
      <a class="btn btn--secondary doc-header__back" href="/">На главную</a>
      <button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label="Переключить тему оформления" aria-pressed="false">
        <span class="theme-toggle__icon theme-toggle__icon--sun">${iconSun()}</span>
        <span class="theme-toggle__icon theme-toggle__icon--moon">${iconMoon()}</span>
      </button>
    </div>
  </header>
  <main id="main" class="doc-main">
    <div class="container doc">
      ${body}
    </div>
  </main>
  <footer class="doc-footer">
    <div class="container">© 2014–${new Date().getFullYear()} ${escapeHtml(site.brand)} · <a href="/">Главная</a> · <a href="/privacy.html">Политика конфиденциальности</a> · <a href="/credits.html">Изображения</a></div>
  </footer>
</body>
</html>`;
}

function iconSun() {
  return '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
}

function iconMoon() {
  return '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>';
}

export function renderPrivacy() {
  const body = `<article class="doc-body">
    <p class="eyebrow">Документы</p>
    <h1>Политика конфиденциальности</h1>
    <p class="doc-meta">Редакция от 12 ноября 2026 года. Документ описывает, как ${escapeHtml(site.legalName)} обрабатывает персональные данные посетителей сайта.</p>

    <h2 id="general">1. Общие положения</h2>
    <p>Настоящая политика составлена в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» и определяет порядок обработки персональных данных и меры по обеспечению их безопасности, предпринимаемые ${escapeHtml(site.legalName)} (далее — Оператор), ИНН ${site.inn}, ОГРН ${site.ogrn}, адрес: ${escapeHtml(site.address)}.</p>
    <p>Используя сайт и отправляя заявку, посетитель подтверждает согласие с условиями настоящей политики.</p>

    <h2 id="data">2. Какие данные мы собираем</h2>
    <ul>
      <li>имя, указанное в форме заявки;</li>
      <li>номер телефона;</li>
      <li>комментарий к заявке, если посетитель его оставил;</li>
      <li>предпочтительный способ связи (звонок, WhatsApp, Telegram);</li>
      <li>обезличенные данные о посещении: страница, источник перехода (UTM), тип устройства, глубина прокрутки — только при согласии на аналитические cookie.</li>
    </ul>
    <p>Оператор не собирает специальные категории персональных данных и биометрические данные.</p>

    <h2 id="purposes">3. Цели обработки</h2>
    <ul>
      <li>связаться с посетителем по заявке и уточнить параметры проекта;</li>
      <li>подготовить смету, эскиз и коммерческое предложение;</li>
      <li>заключить и исполнить договор на изготовление мебели;</li>
      <li>улучшать сайт, анализируя обезличенную статистику посещений.</li>
    </ul>

    <h2 id="legal">4. Правовые основания</h2>
    <p>Обработка осуществляется на основании согласия субъекта персональных данных (п. 1 ч. 1 ст. 6 152-ФЗ), а также в целях исполнения договора, стороной которого является субъект данных.</p>

    <h2 id="storage">5. Сроки хранения и передача</h2>
    <p>Данные заявки хранятся не более трёх лет с момента последнего обращения, если иное не предусмотрено договором или законом. Оператор не продаёт и не передаёт данные третьим лицам, кроме случаев, предусмотренных законом, и подрядчиков, обеспечивающих работу сайта и приём заявок, — на условиях конфиденциальности.</p>

    <h2 id="rights">6. Права посетителя</h2>
    <p>Посетитель вправе запросить сведения об обработке своих данных, потребовать их уточнения, блокирования или уничтожения, а также отозвать согласие. Для этого напишите на <a href="mailto:${site.email}">${site.email}</a> или позвоните по номеру <a href="${site.phoneHref}">${site.phone}</a>. Запрос рассматривается в течение 30 календарных дней.</p>

    <h2 id="cookies">7. Cookie и аналитика</h2>
    <p>Сайт использует необходимые cookie для запоминания выбранной темы оформления и решения о cookie-баннере. Эти файлы не передают данные третьим лицам.</p>
    <p>Аналитические cookie (Яндекс.Метрика или Google Analytics 4 — счётчик уточняется заказчиком) подключаются только после нажатия «Принять» в баннере. До этого момента события аналитики собираются локально и не отправляются. Отказаться можно кнопкой «Только необходимые» или через ссылку «Настройки cookie» в подвале сайта.</p>

    <h2 id="security">8. Меры защиты</h2>
    <p>Доступ к заявкам ограничен сотрудниками, которые работают с обращениями. Передача данных с сайта идёт по HTTPS. Оператор применяет организационные и технические меры защиты от неправомерного доступа, копирования и распространения данных.</p>

    <h2 id="changes">9. Изменения политики</h2>
    <p>Оператор вправе изменять политику. Новая редакция вступает в силу с момента публикации на этой странице; дата редакции указана в начале документа.</p>

    <h2 id="consent">10. Согласие на обработку персональных данных</h2>
    <p>Отправляя форму на сайте, посетитель свободно, своей волей и в своём интересе даёт ${escapeHtml(site.legalName)} согласие на обработку указанных им персональных данных (имя, телефон, комментарий, способ связи) в целях, перечисленных в разделе 3, включая сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, использование, обезличивание, блокирование и уничтожение данных.</p>
    <p>Согласие действует до его отзыва. Отозвать согласие можно письмом на <a href="mailto:${site.email}">${site.email}</a>; обработка прекращается в течение 30 дней, если нет иных законных оснований.</p>

    <p class="doc-note">Документ подготовлен как рабочий шаблон. Перед публикацией на продакшн-домене его необходимо проверить с юристом заказчика и подставить фактические реквизиты (ТЗ, п. 17.9).</p>
  </article>`;
  return legalLayout({
    title: 'Политика конфиденциальности — ' + site.brand,
    description: 'Как мебельная мастерская «' + site.brand + '» обрабатывает персональные данные посетителей сайта и какие cookie использует.',
    canonical: '/privacy.html',
    body,
  });
}

export function renderCredits(manifest) {
  const rows = manifest
    .map(
      (item) => `<tr>
      <td>${escapeHtml(item.id)}</td>
      <td><a href="${item.source.page}" target="_blank" rel="noopener">${escapeHtml(item.source.title)}</a></td>
      <td>${escapeHtml(item.source.author)}</td>
      <td><a href="${item.source.licenseUrl}" target="_blank" rel="noopener">${escapeHtml(item.source.license)}</a></td>
    </tr>`,
    )
    .join('\n');

  const body = `<article class="doc-body">
    <p class="eyebrow">Документы</p>
    <h1>Использованные изображения</h1>
    <p class="doc-meta">Все фотографии на сайте взяты из свободных источников и оптимизированы для веба. Ниже — авторы, лицензии и ссылки на оригиналы.</p>
    <p>Изображения под лицензией CC BY 2.0 используются с указанием автора и лицензии, как того требуют условия. Изображения CC0 (public domain) приведены для полноты списка.</p>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <caption class="visually-hidden">Список изображений, авторов и лицензий</caption>
        <thead><tr><th scope="col">Блок</th><th scope="col">Оригинал</th><th scope="col">Автор</th><th scope="col">Лицензия</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <h2>Шрифты</h2>
    <p>Manrope (Mikhail Sharanda) и Cormorant Garamond (Christian Thalmann) распространяются по SIL Open Font License 1.1 и размещены локально в каталоге <code>/assets/fonts</code>.</p>
    <h2>Иконки</h2>
    <p>Иконки нарисованы для этого сайта как inline-SVG и не требуют отдельной атрибуции.</p>
    <p class="doc-note">Перед публикацией фотографии проектов нужно заменить на съёмку заказчика (ТЗ, п. 17.10). Свободные изображения использованы как демонстрационный контент.</p>
  </article>`;
  return legalLayout({
    title: 'Использованные изображения — ' + site.brand,
    description: 'Авторы и лицензии фотографий, использованных на сайте мебельной мастерской «' + site.brand + '».',
    canonical: '/credits.html',
    body,
  });
}

export function render404() {
  const body = `<article class="doc-body doc-body--center">
    <p class="eyebrow">Ошибка 404</p>
    <h1>Страница не найдена</h1>
    <p>Возможно, ссылка устарела или в адресе опечатка. Вернитесь на главную — там все разделы, работы и форма заявки.</p>
    <p><a class="btn btn--primary" href="/">На главную</a></p>
  </article>`;
  return legalLayout({
    title: 'Страница не найдена — ' + site.brand,
    description: 'Страница не найдена. Перейдите на главную страницу сайта мебельной мастерской.',
    canonical: '/404.html',
    body,
  });
}
