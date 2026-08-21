/* ==========================================================================
   Kontra-Africa — Landing page interactions
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initYear();
  initHeaderScroll();
  initMobileNav();
  initRevealOnScroll();
  initInstallCarousel();
  initCountriesCarousel();
});

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
   IDs attendus dans le HTML :
     #navToggle        -> bouton hamburger (3 traits), aria-controls="mobileNavPanel"
     #mobileNavPanel    -> panneau latéral (aside/nav), role="dialog", aria-hidden="true"
     #mobileNavClose     -> bouton X à l'intérieur du panneau
     #mobileNavOverlay  -> overlay sombre derrière le panneau
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

  // Fermeture après clic sur un lien du panneau
  panel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closePanel);
  });

  // Fermeture avec Escape + piège de focus basique (Tab reste dans le panneau)
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
   Carrousel des captures d'écran de l'application
   IDs / classes attendus dans le HTML :
     #installCarousel     -> conteneur global
     .install-slide       -> chaque capture (contient une <img>), une seule visible à la fois
     #installNextBtn       -> le bouton violet, passe à la capture suivante
     #installDots          -> conteneur des indicateurs (généré dynamiquement)
   Chaque slide doit avoir sa propre image, ex :
     <div class="install-slide is-active"><img src="assets/images/app-screenshot-1.png" alt="..."></div>
     <div class="install-slide"><img src="assets/images/app-screenshot-2.png" alt="..."></div>
     <div class="install-slide"><img src="assets/images/app-screenshot-3.png" alt="..."></div>
   ========================================================================== */
function initInstallCarousel() {
  const carousel = document.getElementById('installCarousel');
  const nextBtn = document.getElementById('installNextBtn');
  const dotsContainer = document.getElementById('installDots');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.install-slide'));
  if (!slides.length) return;

  let currentIndex = slides.findIndex((slide) => slide.classList.contains('is-active'));
  if (currentIndex < 0) currentIndex = 0;

  // Génère les indicateurs si un conteneur est présent
  let dots = [];
  if (dotsContainer) {
    dotsContainer.innerHTML = '';
    slides.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'install-dot';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Aller à la capture ${index + 1}`);
      dot.addEventListener('click', () => goToSlide(index));
      dotsContainer.appendChild(dot);
    });
    dots = Array.from(dotsContainer.children);
  }

  function render() {
    slides.forEach((slide, index) => {
      slide.classList.toggle('is-active', index === currentIndex);
      slide.setAttribute('aria-hidden', String(index !== currentIndex));
    });
    dots.forEach((dot, index) => {
      dot.setAttribute('aria-selected', String(index === currentIndex));
    });
  }

  function goToSlide(index) {
    currentIndex = ((index % slides.length) + slides.length) % slides.length;
    render();
  }

  function goToNext() {
    goToSlide(currentIndex + 1);
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', goToNext);
  }

  render();
}

/* ==========================================================================
   Carrousel "Pays accessibles"
   IDs attendus dans le HTML :
     #countriesTrack   -> conteneur scrollable horizontal (overflow-x: auto, scroll-snap-type: x)
                           contenant les cartes pays (une par pays, ex: .country-card)
     #countriesPrev    -> bouton précédent (‹)
     #countriesNext    -> bouton suivant (›)
   ========================================================================== */
function initCountriesCarousel() {
  const track = document.getElementById('countriesTrack');
  const prevBtn = document.getElementById('countriesPrev');
  const nextBtn = document.getElementById('countriesNext');
  if (!track) return;

  const cards = Array.from(track.children);
  if (!cards.length) return;

  const smoothBehavior = prefersReducedMotion() ? 'auto' : 'smooth';

  function scrollByCard(direction) {
    const card = cards[0];
    const cardStyle = window.getComputedStyle(card);
    const gap = parseInt(cardStyle.marginRight, 10) || 16;
    const amount = card.getBoundingClientRect().width + gap;
    track.scrollBy({ left: amount * direction, behavior: smoothBehavior });
  }

  function isAtStart() {
    return track.scrollLeft <= 4;
  }

  function isAtEnd() {
    return track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  }

  function goNext() {
    if (isAtEnd()) {
      track.scrollTo({ left: 0, behavior: smoothBehavior });
    } else {
      scrollByCard(1);
    }
  }

  function goPrev() {
    if (isAtStart()) {
      track.scrollTo({ left: track.scrollWidth, behavior: smoothBehavior });
    } else {
      scrollByCard(-1);
    }
  }

  if (nextBtn) nextBtn.addEventListener('click', goNext);
  if (prevBtn) prevBtn.addEventListener('click', goPrev);

  // Drag / glisser à la souris sur desktop (en plus du swipe tactile natif sur mobile)
  let isDragging = false;
  let startX = 0;
  let startScrollLeft = 0;

  track.addEventListener('mousedown', (event) => {
    isDragging = true;
    track.classList.add('is-dragging');
    startX = event.pageX;
    startScrollLeft = track.scrollLeft;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    track.classList.remove('is-dragging');
  });

  track.addEventListener('mouseleave', () => {
    isDragging = false;
    track.classList.remove('is-dragging');
  });

  track.addEventListener('mousemove', (event) => {
    if (!isDragging) return;
    event.preventDefault();
    const delta = event.pageX - startX;
    track.scrollLeft = startScrollLeft - delta;
  });
}
