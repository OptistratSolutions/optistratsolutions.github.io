const navToggle = document.querySelector('[data-nav-toggle]');
const siteNav = document.querySelector('[data-site-nav]');

const closeNav = () => {
  if (!navToggle || !siteNav) return;
  navToggle.setAttribute('aria-expanded', 'false');
  siteNav.dataset.open = 'false';
  document.body.classList.remove('nav-locked');
};

if (navToggle && siteNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!isOpen));
    siteNav.dataset.open = String(!isOpen);
    document.body.classList.toggle('nav-locked', !isOpen);
  });

  siteNav.addEventListener('click', event => {
    if (event.target.closest('a')) closeNav();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeNav();
      navToggle.focus();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeNav();
  });
}

const revealItems = document.querySelectorAll('[data-reveal]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion || !('IntersectionObserver' in window)) {
  revealItems.forEach(item => item.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  revealItems.forEach(item => revealObserver.observe(item));
}

document.querySelectorAll('[data-year]').forEach(item => {
  item.textContent = new Date().getFullYear();
});
