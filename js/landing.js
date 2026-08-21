/* ==========================================================================
   Kontra-Africa — Landing page interactions
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Chaque init est isolée : si l'une échoue, les autres continuent quand même
  // (et surtout, le contenu de la page ne reste jamais caché).
  safeRun(initYear);
  safeRun(initHeaderScroll);
  safeRun(initMobileNav);
  safeRun(initRevealOnScroll);
  safeRun(initInstallCarousel);
  safeRun(initCountriesCarousel);

  // Filet de sécurité : si un élément .reveal n'a toujours pas été
  // révélé après 1,5s (observateur non déclenché, bug quelconque...),
  // on force son affichage pour ne jamais laisser la page vide.
  setTimeout(() => {
    document.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => {
      el.classList.add('is-visible');
    });
  }, 1500);
});

function safeRun(fn) {
  try {
    fn();
  } catch (error) {
    console.error(`[Kontra-Africa] Erreur dans ${fn.name || 'une fonction'} :`, error);
  }
}

/* Respecte prefers-reduced-motion partout où on choisit un comportement de scroll/anim */
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* --- Année dynamique dans le footer --- */
function initYear() {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

/* --- Header : ombre/bordure au scroll --- */
function initHeaderScroll() {
  const header = document.getElementById('siteHeader');
  if (!header) return;
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ==========================================================================
   Menu mobile — panneau latéral depuis la droite
   ========================================================================== */
function initMobileNav() {
  const toggle = document.getElementById('navToggle');
  const panel = document.getElementById('mobileNavPanel');
  const closeBtn = document.getElementById('mobileNavClose');
  const overlay = document.getElementById('mobileNavOverlay');
  if (!toggle || !panel) return;

  let isOpen = false;
  let lastFocusedEl = null;

  const getFocusableElements = () =>
    Array.from(
      panel.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );

  const openPanel = () => {
    if (isOpen) return;
    isOpen = true;
    lastFocusedEl = document.activeElement;

    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('nav-open');
    document.body.style.overflow = 'hidden';

    const focusTarget = closeBtn || getFocusableElements()[0];
    if (focusTarget) focusTarget.focus();
  };

  const closePanel = () => {
    if (!isOpen) return;
    isOpen = false;

    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('nav-open');
    document.body.style.overflow = 'auto';

    const refocusTarget = lastFocusedEl || toggle;
    if (refocusTarget) refocusTarget.focus();
  };

  toggle.setAttribute('aria-expanded', 'false');
  panel.setAttribute('aria-hidden', 'true');
  if (overlay) overlay.setAttribute('aria-hidden', 'true');

  toggle.addEventListener('click', () => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closePanel);
  }

  if (overlay) {
    overlay.addEventListener('click', closePanel);
  }

  panel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closePanel);
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      closePanel();
      return;
    }

    if (event.key === 'Tab') {
      const focusable = getFocusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

/* --- Animation d'apparition au scroll --- */
function initRevealOnScroll() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  items.forEach((el) => observer.observe(el));
}

/* ==========================================================================
   Carrousel auto-défilant générique ("marquee")
   - duplique une fois le contenu du track pour permettre une boucle sans saut
   - fait défiler viewport.scrollLeft en continu via requestAnimationFrame
   - se met en pause au survol (desktop) et pendant une interaction tactile/souris,
     puis reprend automatiquement après un court délai
   - reste utilisable au swipe/drag natif du navigateur (overflow-x: auto)
   ========================================================================== */
function createAutoScrollCarousel({ viewport, track, speed = 36, pauseOnHover = true }) {
  if (!viewport || !track) return null;

  const originalItems = Array.from(track.children);
  if (!originalItems.length) return null;

  // Duplique une seule fois les éléments pour créer une boucle continue fluide
  if (!track.dataset.duplicated) {
    originalItems.forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
    track.dataset.duplicated = 'true';
  }

  let loopWidth = 0;
  function measure() {
    loopWidth = track.scrollWidth / 2;
  }
  measure();
  window.addEventListener('resize', measure);

  const reduceMotion = prefersReducedMotion();
  let isHovered = false;
  let isInteracting = false;
  let resumeTimer = null;
  let lastTimestamp = null;
  let rafId = null;

  function pauseTemporarily(duration = 2200) {
    isInteracting = true;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      isInteracting = false;
    }, duration);
  }

  function step(timestamp) {
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const delta = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (!isHovered && !isInteracting && loopWidth > 0) {
      viewport.scrollLeft += speed * delta;
      if (viewport.scrollLeft >= loopWidth) {
        viewport.scrollLeft -= loopWidth;
      }
    }
    rafId = requestAnimationFrame(step);
  }

  if (!reduceMotion) {
    rafId = requestAnimationFrame(step);
  }

  if (pauseOnHover) {
    viewport.addEventListener('mouseenter', () => { isHovered = true; });
    viewport.addEventListener('mouseleave', () => { isHovered = false; });
  }

  // Interaction tactile / souris : on laisse le swipe natif agir, puis on reprend
  viewport.addEventListener('touchstart', () => pauseTemporarily(3000), { passive: true });
  viewport.addEventListener('touchend', () => pauseTemporarily(1500), { passive: true });
  viewport.addEventListener('pointerdown', () => pauseTemporarily(3000));
  viewport.addEventListener('wheel', () => pauseTemporarily(1800), { passive: true });

  return {
    scrollByAmount(amount) {
      pauseTemporarily(2500);
      viewport.scrollBy({ left: amount, behavior: reduceMotion ? 'auto' : 'smooth' });
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      if (resumeTimer) clearTimeout(resumeTimer);
      window.removeEventListener('resize', measure);
    }
  };
}

/* ==========================================================================
   Carrousel "Comment l'installer" — défilement automatique en boucle
   ========================================================================== */
function initInstallCarousel() {
  const viewport = document.getElementById('installCarousel');
  const track = document.getElementById('installTrack');
  createAutoScrollCarousel({ viewport, track, speed: 34, pauseOnHover: true });
}

/* ==========================================================================
   Carrousel "Pays accessibles" — défilement automatique continu en boucle,
   avec boutons précédent/suivant en complément
   ========================================================================== */
function initCountriesCarousel() {
  const viewport = document.getElementById('countriesViewport');
  const track = document.getElementById('countriesTrack');
  const prevBtn = document.getElementById('countriesPrev');
  const nextBtn = document.getElementById('countriesNext');
  if (!viewport || !track) return;

  const controller = createAutoScrollCarousel({ viewport, track, speed: 30, pauseOnHover: true });
  if (!controller) return;

  function cardStep() {
    const card = track.querySelector('.country-card');
    if (!card) return 160;
    const style = window.getComputedStyle(card);
    const gap = parseInt(style.marginRight, 10) || 16;
    return card.getBoundingClientRect().width + gap;
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => controller.scrollByAmount(cardStep()));
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', () => controller.scrollByAmount(-cardStep()));
  }
}
