import { track } from './analytics.mjs';

/* ------------------------------------------------------------------ header */
function initHeader() {
  const header = document.querySelector('[data-header]');
  if (!header) return;
  const onScroll = () => {
    header.dataset.scrolled = window.scrollY > 8 ? 'true' : 'false';
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* -------------------------------------------------------------------- menu */
function initMenu() {
  const burger = document.querySelector('[data-burger]');
  const nav = document.querySelector('[data-nav]');
  if (!burger || !nav) return;

  const close = ({ focus = false } = {}) => {
    nav.dataset.open = 'false';
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Открыть меню');
    if (focus) burger.focus();
  };

  burger.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') !== 'true';
    nav.dataset.open = String(open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (open) {
      nav.querySelector('a, button')?.focus();
      track('menu_open');
    }
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
      close({ focus: true });
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) close();
  });
}

/* ---------------------------------------------------------------- scrollspy */
function initScrollspy() {
  const links = [...document.querySelectorAll('[data-nav-link]')];
  const sections = links
    .map((link) => document.getElementById(link.dataset.navLink))
    .filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;

  const setActive = (id) => {
    links.forEach((link) => {
      // aria-current не должен висеть со значением «false» — просто убираем.
      if (link.dataset.navLink === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    },
    { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
  );
  sections.forEach((section) => observer.observe(section));
}

/* -------------------------------------------------------------------- back */
function initToTop() {
  const button = document.querySelector('[data-to-top]');
  if (!button) return;
  const update = () => {
    button.hidden = window.scrollY < window.innerHeight * 0.6;
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    document.querySelector('.skip-link')?.focus?.();
  });
}

/* ---------------------------------------------------------------- accordion */
function initAccordion() {
  document.querySelectorAll('[data-accordion]').forEach((root) => {
    root.querySelectorAll('.accordion-item__trigger').forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const expanded = trigger.getAttribute('aria-expanded') === 'true';
        const panel = document.getElementById(trigger.getAttribute('aria-controls'));
        trigger.setAttribute('aria-expanded', String(!expanded));
        if (panel) panel.hidden = expanded;
        if (!expanded) track('faq_open', { question: trigger.textContent.trim().slice(0, 80) });
      });

      trigger.addEventListener('keydown', (event) => {
        const triggers = [...root.querySelectorAll('.accordion-item__trigger')];
        const index = triggers.indexOf(trigger);
        let next = null;
        if (event.key === 'ArrowDown') next = triggers[(index + 1) % triggers.length];
        if (event.key === 'ArrowUp') next = triggers[(index - 1 + triggers.length) % triggers.length];
        if (event.key === 'Home') next = triggers[0];
        if (event.key === 'End') next = triggers[triggers.length - 1];
        if (next) {
          event.preventDefault();
          next.focus();
        }
      });
    });
  });
}

/* -------------------------------------------------------------------- modal */
function createModal(root, { onOpen, onClose } = {}) {
  if (!root) return null;
  let lastFocused = null;

  const focusables = () =>
    [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node.offsetParent !== null || node === document.activeElement);

  const open = () => {
    lastFocused = document.activeElement;
    root.hidden = false;
    document.body.classList.add('is-locked');
    const target = root.querySelector('[data-autofocus]') || focusables()[0] || root.querySelector('[role="dialog"]');
    requestAnimationFrame(() => target?.focus?.());
    onOpen?.();
  };

  const close = () => {
    if (root.hidden) return;
    root.hidden = true;
    if (!document.querySelector('.modal:not([hidden]), .lightbox:not([hidden])')) {
      document.body.classList.remove('is-locked');
    }
    onClose?.();
    lastFocused?.focus?.();
  };

  root.querySelectorAll('[data-modal-close], [data-lightbox-close]').forEach((node) => {
    node.addEventListener('click', close);
  });

  // Esc и Tab ловим на документе: после отправки формы фокус может уйти на
  // body, и обработчик на самом окне перестал бы получать клавиши.
  const onDocumentKeydown = (event) => {
    if (root.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
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
  };
  document.addEventListener('keydown', onDocumentKeydown);

  return { open, close, isOpen: () => !root.hidden };
}

/* --------------------------------------------------------------- lead modal */
function initLeadModal(initForm) {
  const modal = document.querySelector('[data-modal]');
  const roots = [modal].filter(Boolean);
  if (!roots.length) return null;

  const instance = createModal(modal, {
    onOpen: () => {
      track('form_open', { place: 'modal' });
      document.dispatchEvent(new CustomEvent('leadmodal:open'));
    },
  });

  document.querySelectorAll('[data-open-lead]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      instance.open();
    });
  });

  const form = modal.querySelector('[data-lead-form]');
  if (form) {
    initForm(form, {
      onSuccess: () => {
        track('form_submit', { place: 'modal' });
        setTimeout(() => instance.close(), 4000);
      },
      onError: () => track('form_error', { place: 'modal' }),
    });
  }

  return instance;
}

/* ----------------------------------------------------------------- lightbox */
function initLightbox(portfolio) {
  const root = document.querySelector('[data-lightbox-root]');
  if (!root || !portfolio?.length) return;
  const media = root.querySelector('[data-lightbox-media]');
  const title = root.querySelector('[data-lightbox-title]');
  const details = root.querySelector('[data-lightbox-details]');
  const term = root.querySelector('[data-lightbox-term]');
  const instance = createModal(root);
  let current = null;

  const show = (index) => {
    const item = portfolio[index];
    if (!item) return;
    current = index;
    media.innerHTML = `<picture>
      <source type="image/avif" srcset="${item.sources.avif}" sizes="(max-width: 1100px) 100vw, 1100px">
      <source type="image/webp" srcset="${item.sources.webp}" sizes="(max-width: 1100px) 100vw, 1100px">
      <img src="${item.sources.jpg}" srcset="${item.sources.jpgSrcset}" sizes="(max-width: 1100px) 100vw, 1100px" width="${item.width}" height="${item.height}" alt="${item.alt}" loading="eager" decoding="async">
    </picture>`;
    title.textContent = item.title;
    details.textContent = item.details;
    term.textContent = item.term;
  };

  document.querySelectorAll('[data-lightbox]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.lightbox);
      show(index);
      instance.open();
      track('portfolio_open', { project: portfolio[index]?.title });
    });
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const next = event.key === 'ArrowRight' ? current + 1 : current - 1;
    if (next >= 0 && next < portfolio.length) {
      show(next);
      track('portfolio_open', { project: portfolio[next]?.title });
    }
  });
}

/* ------------------------------------------------------------------ cookies */
function initCookies({ analytics, saveConsent, readConsent }) {
  const banner = document.querySelector('[data-cookie-banner]');
  if (!banner) return;
  const consent = readConsent();
  if (!consent) {
    setTimeout(() => {
      banner.hidden = false;
    }, 1200);
  }

  banner.querySelector('[data-cookie-accept]')?.addEventListener('click', () => {
    saveConsent('all');
    banner.hidden = true;
    if (analytics) analytics();
  });

  banner.querySelector('[data-cookie-decline]')?.addEventListener('click', () => {
    saveConsent('necessary');
    banner.hidden = true;
  });

  document.querySelectorAll('[data-cookie-settings]').forEach((button) => {
    button.addEventListener('click', () => {
      banner.hidden = false;
      banner.querySelector('[data-cookie-accept]')?.focus();
    });
  });
}

/* ------------------------------------------------------------------- reveal */
function initReveal() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll(
    '.section-head, .card, .direction, .step, .work, .material, .guarantee, .review, .section-cta',
  );
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
  );
  targets.forEach((node) => {
    node.classList.add('reveal');
    observer.observe(node);
  });
}

export function initUI({ initForm, portfolio, analytics, saveConsent, readConsent }) {
  initHeader();
  initMenu();
  initScrollspy();
  initToTop();
  initAccordion();
  initLeadModal(initForm);
  initLightbox(portfolio);
  initCookies({ analytics, saveConsent, readConsent });
  initReveal();

  // Встроенная форма в финальном блоке. Место отправки знает только тот, кто
  // создал форму, поэтому событие шлём здесь, а не общим слушателем документа:
  // иначе отправка из модалки и из секции считалась бы дважды.
  document.querySelectorAll('main [data-lead-form]').forEach((form) => {
    initForm(form, {
      onSuccess: () => track('form_submit', { place: 'section' }),
      onError: () => track('form_error', { place: 'section' }),
    });
  });
}
