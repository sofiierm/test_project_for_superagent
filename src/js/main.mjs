import { site } from '../content/site.mjs';
import { initTheme } from './theme.mjs';
import { initLeadForm } from './forms.mjs';
import { initUI } from './ui.mjs';
import { bindTracking, saveConsent, readConsent } from './analytics.mjs';

const portfolio = JSON.parse(document.getElementById('portfolio-data')?.textContent || '[]');

function boot() {
  initTheme();
  initUI({
    initForm: initLeadForm,
    portfolio,
    saveConsent,
    readConsent,
    analytics: () => bindTracking(site.analytics),
  });
  bindTracking(site.analytics);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
