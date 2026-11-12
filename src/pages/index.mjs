import { site, nav, trust, about, advantages, directions, process, portfolio, materials, guarantees, reviews, faq } from '../content/site.mjs';
import { icon } from '../lib/icons.mjs';
import { picture, escapeHtml, formatDate } from '../lib/html.mjs';
import { formFields, formMarkup } from './_form.mjs';

function stars() {
  return `<span class="stars" role="img" aria-label="Оценка 5 из 5">${Array.from({ length: 5 }, () => icon('star', { size: 16 })).join('')}</span>`;
}

function sectionHead({ id, eyebrow, title, lead, align = 'left' }) {
  return `<div class="section-head section-head--${align}">
    <p class="eyebrow">${eyebrow}</p>
    <h2 id="${id}-title">${title}</h2>
    ${lead ? `<p class="section-lead">${lead}</p>` : ''}
  </div>`;
}

function hero() {
  return `<section class="hero" id="top" aria-labelledby="hero-title">
  <div class="hero__media" aria-hidden="true">
    ${picture('hero-interior', {
      sizes: '100vw',
      loading: 'eager',
      fetchpriority: 'high',
      decorative: true,
      className: 'hero__picture',
    })}
  </div>
  <div class="container hero__inner">
    <div class="hero__content">
      <p class="eyebrow eyebrow--light">Мебельная мастерская полного цикла · Москва</p>
      <h1 id="hero-title">Мебель на заказ, которая встаёт в ваш интерьер с первого раза</h1>
      <p class="hero__lead">Проектируем, производим и монтируем кухни, шкафы и мебель для квартиры. Замер, чертёж и смета — бесплатно, сроки закреплены в договоре.</p>
      <div class="hero__actions">
        <button type="button" class="btn btn--primary" data-open-lead>Рассчитать стоимость</button>
        <a class="btn btn--ghost btn--on-dark" href="#portfolio">Смотреть работы</a>
      </div>
      <dl class="trust">
        ${trust
          .map(
            (item) => `<div class="trust__item">
          <dt>${escapeHtml(item.value)}</dt>
          <dd>${escapeHtml(item.label)}</dd>
        </div>`,
          )
          .join('')}
      </dl>
    </div>
  </div>
  <a class="hero__scroll" href="#about" aria-label="Перейти к блоку о компании">${icon('arrowDown', { size: 20 })}</a>
</section>`;
}

function aboutSection() {
  return `<section class="section about" id="about" aria-labelledby="about-title">
  <div class="container about__grid">
    <div class="about__text">
      ${sectionHead({ id: 'about', eyebrow: 'О компании', title: about.title, lead: about.lead })}
      ${about.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
      <ul class="about__stats" aria-label="Производство в цифрах">
        ${about.stats
          .map(
            (s) => `<li><span class="stat-value">${escapeHtml(s.value)}</span><span class="stat-label">${escapeHtml(s.label)}</span></li>`,
          )
          .join('')}
      </ul>
      <p class="about__link"><a class="link-arrow" href="#portfolio">Посмотреть выполненные проекты ${icon('arrowRight', { size: 18 })}</a></p>
    </div>
    <div class="about__media">
      ${picture('about-workshop', { className: 'about__photo about__photo--wide' })}
      ${picture('about-craftsman', { className: 'about__photo about__photo--tall' })}
    </div>
  </div>
</section>`;
}

function benefitsSection() {
  return `<section class="section benefits" id="benefits" aria-labelledby="benefits-title">
  <div class="container">
    ${sectionHead({
      id: 'benefits',
      eyebrow: 'Почему нас выбирают',
      title: 'Шесть причин доверить проект мастерской',
      lead: 'Мы отвечаем за весь путь — от первого эскиза до последней полки, поэтому не перекладываем ответственность на подрядчиков.',
    })}
    <ul class="cards" role="list">
      ${advantages
        .map(
          (a) => `<li class="card advantage">
        <span class="advantage__icon">${icon(a.icon, { size: 26 })}</span>
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(a.text)}</p>
      </li>`,
        )
        .join('')}
    </ul>
  </div>
</section>`;
}

function directionsSection() {
  return `<section class="section directions" id="directions" aria-labelledby="directions-title">
  <div class="container">
    ${sectionHead({
      id: 'directions',
      eyebrow: 'Направления работы',
      title: 'Что мы делаем',
      lead: 'Работаем с частными заказчиками, дизайнерами и прорабами. Каждое направление ведёт инженер-технолог, который знает ваш проект от эскиза до монтажа.',
    })}
    <ul class="directions__grid" role="list">
      ${directions
        .map(
          (d) => `<li class="direction">
        ${picture(d.image, { className: 'direction__media' })}
        <div class="direction__body">
          <h3>${escapeHtml(d.title)}</h3>
          <p>${escapeHtml(d.text)}</p>
          <p class="direction__note">${escapeHtml(d.note)}</p>
        </div>
      </li>`,
        )
        .join('')}
    </ul>
    <div class="section-cta">
      <p>Не нашли своё направление? Мы делаем любую корпусную мебель по размерам.</p>
      <button type="button" class="btn btn--primary" data-open-lead>Обсудить проект</button>
    </div>
  </div>
</section>`;
}

function processSection() {
  return `<section class="section process" id="process" aria-labelledby="process-title">
  <div class="container">
    ${sectionHead({
      id: 'process',
      eyebrow: 'Как мы работаем',
      title: 'Шесть шагов от заявки до готовой мебели',
      lead: 'Вы всегда знаете, на каком этапе проект: раз в неделю присылаем фотоотчёт и согласуем следующий шаг.',
    })}
    <ol class="steps" role="list">
      ${process
        .map(
          (step, i) => `<li class="step">
        <span class="step__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <h3>${escapeHtml(step.title)}</h3>
        <p>${escapeHtml(step.text)}</p>
      </li>`,
        )
        .join('')}
    </ol>
  </div>
</section>`;
}

function portfolioSection() {
  return `<section class="section portfolio" id="portfolio" aria-labelledby="portfolio-title">
  <div class="container">
    <div class="portfolio__head">
      ${sectionHead({
        id: 'portfolio',
        eyebrow: 'Выполненные проекты',
        title: 'Работы мастерской',
        lead: 'Восемь проектов последних месяцев. Нажмите на фотографию, чтобы рассмотреть детали, материалы и сроки.',
      })}
      <p class="portfolio__hint">${icon('image', { size: 18 })} Фото открываются в увеличенном виде</p>
    </div>
    <ul class="portfolio__grid" role="list">
      ${portfolio
        .map(
          (p, i) => `<li class="work">
        <button type="button" class="work__button" data-lightbox="${i}" aria-label="Открыть фотографию: ${escapeHtml(p.title)}">
          ${picture(p.image, { className: 'work__media', sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw' })}
          <span class="work__overlay" aria-hidden="true">${icon('plus', { size: 22 })}</span>
        </button>
        <div class="work__caption">
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.details)}</p>
          <p class="work__term">${icon('clockSmall', { size: 16 })} ${escapeHtml(p.term)}</p>
        </div>
      </li>`,
        )
        .join('')}
    </ul>
    <div class="section-cta">
      <p>Хотите похожий проект? Пришлите фото-референс — посчитаем стоимость.</p>
      <button type="button" class="btn btn--primary" data-open-lead>Оставить заявку</button>
    </div>
  </div>
</section>`;
}

function materialsSection() {
  return `<section class="section materials" id="materials" aria-labelledby="materials-title">
  <div class="container">
    ${sectionHead({
      id: 'materials',
      eyebrow: 'Материалы и фурнитура',
      title: 'То, из чего складывается срок службы',
      lead: 'Работаем с ЛДСП Egger и Kronospan, шпоном дуба и ореха, фурнитурой Blum и Hettich. Все материалы соответствуют классу эмиссии E1.',
    })}
    <ul class="materials__grid" role="list">
      ${materials
        .map(
          (m) => `<li class="material">
        ${picture(m.image, { className: 'material__media', sizes: '(max-width: 700px) 50vw, 25vw' })}
        <h3>${escapeHtml(m.title)}</h3>
        <p>${escapeHtml(m.text)}</p>
      </li>`,
        )
        .join('')}
    </ul>
  </div>
</section>`;
}

function guaranteesSection() {
  return `<section class="section guarantees" id="guarantees" aria-labelledby="guarantees-title">
  <div class="container guarantees__grid">
    <div class="guarantees__intro">
      ${sectionHead({
        id: 'guarantees',
        eyebrow: 'Гарантии и сервис',
        title: 'Отвечаем за результат после монтажа',
        lead: 'Гарантия, сроки и сервис прописаны в договоре. Если что-то пойдёт не так — вы знаете, к кому обратиться и в какой срок.',
      })}
      <button type="button" class="btn btn--primary" data-open-lead>Получить консультацию</button>
    </div>
    <ul class="guarantees__list" role="list">
      ${guarantees
        .map(
          (g) => `<li class="guarantee">
        <span class="guarantee__icon">${icon('check', { size: 20 })}</span>
        <div><h3>${escapeHtml(g.title)}</h3><p>${escapeHtml(g.text)}</p></div>
      </li>`,
        )
        .join('')}
    </ul>
  </div>
</section>`;
}

function reviewsSection() {
  return `<section class="section reviews" id="reviews" aria-labelledby="reviews-title">
  <div class="container">
    ${sectionHead({
      id: 'reviews',
      eyebrow: 'Отзывы',
      title: 'Что говорят клиенты',
      lead: 'Публикуем отзывы с указанием проекта. Полные тексты и контакты авторов предоставляем по запросу.',
    })}
    <ul class="reviews__grid" role="list">
      ${reviews
        .map(
          (r) => `<li class="review">
        <figure>
          ${stars()}
          <blockquote><p>${escapeHtml(r.text)}</p></blockquote>
          <figcaption>
            <span class="review__author">${escapeHtml(r.author)}</span>
            <span class="review__meta">${escapeHtml(r.project)} · ${formatDate(r.date)}</span>
          </figcaption>
        </figure>
      </li>`,
        )
        .join('')}
    </ul>
  </div>
</section>`;
}

function faqSection() {
  return `<section class="section faq" id="faq" aria-labelledby="faq-title">
  <div class="container faq__grid">
    <div class="faq__intro">
      ${sectionHead({
        id: 'faq',
        eyebrow: 'Частые вопросы',
        title: 'Отвечаем на то, что спрашивают до заказа',
        lead: 'Если вашего вопроса здесь нет — напишите в мессенджер, ответим в течение рабочего дня.',
      })}
      <a class="btn btn--secondary" href="${site.telegram}" target="_blank" rel="noopener" data-track="messenger_click" data-place="faq">Написать в Telegram</a>
    </div>
    <div class="faq__list" data-accordion>
      ${faq
        .map(
          (item, i) => `<div class="accordion-item">
        <h3 class="accordion-item__heading">
          <button type="button" class="accordion-item__trigger" id="faq-q-${i}" aria-expanded="${i === 0}" aria-controls="faq-a-${i}">
            <span>${escapeHtml(item.q)}</span>
            <span class="accordion-item__icon" aria-hidden="true">${icon('plus', { size: 20 })}</span>
          </button>
        </h3>
        <div class="accordion-item__panel" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}" ${i === 0 ? '' : 'hidden'}>
          <p>${escapeHtml(item.a)}</p>
        </div>
      </div>`,
        )
        .join('')}
    </div>
  </div>
</section>`;
}

function contactSection() {
  return `<section class="section lead" id="contact" aria-labelledby="contact-title">
  <div class="container lead__grid">
    <div class="lead__intro">
      ${sectionHead({
        id: 'contact',
        eyebrow: 'Заявка',
        title: 'Рассчитаем стоимость за один день',
        lead: `Оставьте контакты — инженер свяжется с вами в течение ${site.responseMinutes} минут в рабочее время, уточнит задачу и предложит время замера.`,
      })}
      <ul class="lead__points" role="list">
        <li>${icon('check', { size: 18 })} Замер и эскиз бесплатно в пределах МКАД</li>
        <li>${icon('check', { size: 18 })} Смета по позициям, без скрытых доплат</li>
        <li>${icon('check', { size: 18 })} Сроки и гарантия закреплены в договоре</li>
      </ul>
      <div class="lead__contacts">
        <a class="lead__phone" href="${site.phoneHref}" data-track="phone_click" data-place="lead">${site.phone}</a>
        <p>${escapeHtml(site.hours)}</p>
      </div>
    </div>
    <div class="lead__form-wrap">
      ${formMarkup({ id: 'lead-inline', heading: 'Заявка на расчёт', compact: false })}
    </div>
  </div>
</section>`;
}

function contactsSection() {
  return `<section class="section contacts" id="contacts" aria-labelledby="contacts-title">
  <div class="container contacts__grid">
    <div class="contacts__info">
      ${sectionHead({
        id: 'contacts',
        eyebrow: 'Контакты',
        title: 'Приезжайте в шоурум или напишите',
        lead: 'Покажем образцы материалов, обсудим проект и посчитаем стоимость на месте.',
      })}
      <ul class="contact-list" role="list">
        <li>${icon('phone', { size: 20 })}<div><span class="contact-list__label">Телефон</span><a href="${site.phoneHref}" data-track="phone_click" data-place="contacts">${site.phone}</a></div></li>
        <li>${icon('mail', { size: 20 })}<div><span class="contact-list__label">E-mail</span><a href="mailto:${site.email}">${site.email}</a></div></li>
        <li>${icon('pin', { size: 20 })}<div><span class="contact-list__label">Адрес</span><span>${escapeHtml(site.address)}</span></div></li>
        <li>${icon('clockSmall', { size: 20 })}<div><span class="contact-list__label">Часы работы</span><span>${escapeHtml(site.hours)}</span></div></li>
      </ul>
      <div class="contacts__messengers">
        <a class="btn btn--secondary" href="${site.whatsapp}" target="_blank" rel="noopener" data-track="messenger_click" data-place="contacts">${icon('whatsapp', { size: 18 })} WhatsApp</a>
        <a class="btn btn--secondary" href="${site.telegram}" target="_blank" rel="noopener" data-track="messenger_click" data-place="contacts">${icon('telegram', { size: 18 })} Telegram</a>
      </div>
    </div>
    <div class="contacts__map">
      <a class="map-card" href="https://www.openstreetmap.org/?mlat=${site.map.lat}&mlon=${site.map.lon}#map=${site.map.zoom}/${site.map.lat}/${site.map.lon}" target="_blank" rel="noopener" aria-label="${escapeHtml(site.map.title)} — открыть карту в новой вкладке">
        <picture class="map-card__picture">
          <source type="image/avif" srcset="/assets/img/map-960.avif 960w, /assets/img/map-1440.avif 1440w" sizes="(max-width: 900px) 100vw, 50vw">
          <source type="image/webp" srcset="/assets/img/map-960.webp 960w, /assets/img/map-1440.webp 1440w" sizes="(max-width: 900px) 100vw, 50vw">
          <img src="/assets/img/map-960.jpg" width="960" height="640" alt="Карта: ${escapeHtml(site.addressShort)}" loading="lazy" decoding="async">
        </picture>
        <span class="map-card__badge">${icon('pin', { size: 18 })} ${escapeHtml(site.addressShort)}</span>
      </a>
      <p class="map-card__attribution">Карта: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></p>
    </div>
  </div>
</section>`;
}

export function renderIndex(ctx) {
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  ${ctx.head}
</head>
<body>
  <a class="skip-link" href="#main">Перейти к содержимому</a>
  ${ctx.header}
  <main id="main">
    ${hero()}
    ${aboutSection()}
    ${benefitsSection()}
    ${directionsSection()}
    ${processSection()}
    ${portfolioSection()}
    ${materialsSection()}
    ${guaranteesSection()}
    ${reviewsSection()}
    ${faqSection()}
    ${contactSection()}
    ${contactsSection()}
  </main>
  ${ctx.footer}
  ${ctx.overlays}
</body>
</html>`;
}

export { formFields };
