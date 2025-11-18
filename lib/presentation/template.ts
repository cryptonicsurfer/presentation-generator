/**
 * Generate the base HTML template for presentations
 */
export function generatePresentationHTML(title: string, sections: string[]): string {
  // AGGRESSIVELY remove ALL <script> tags from Claude-generated sections
  let totalScriptsRemoved = 0;
  const cleanedSections = sections.map((section, index) => {
    const before = section.length;

    let cleaned = section;
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');

    // Inject unique ID if not present
    // We use index + 1 because title slide will be slide-0 (or we can make title slide slide-1)
    // Let's make Title = slide-0, Content = slide-1..N, Thank You = slide-N+1
    // But here 'sections' are just the content slides.
    // The actual full list is assembled in the route handler usually.
    // Wait, the route handler calls generatePresentationHTML with the FULL list including title/thankyou.
    // Let's just inject IDs based on the loop index.
    if (!cleaned.includes('id="slide-')) {
      cleaned = cleaned.replace(/<section class="slide/, `<section id="slide-${index}" class="slide`);
    }

    const after = cleaned.length;
    if (before !== after) {
      totalScriptsRemoved++;
      console.log(`[Template] Section ${index}: Removed ${before - after} chars of <script> tags`);
    }

    return cleaned;
  });

  return `<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Falkenberg Kommun</title>
    <!-- Script tags removed from ${totalScriptsRemoved} sections to prevent conflicts -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;800&family=Lato:wght@300;400&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        'falkenberg-marinblå': '#13153b',
                        'falkenberg-kommunblå': '#1f4e99',
                        'falkenberg-blåklint': '#607ebe',
                        'falkenberg-cyan': '#009fe3',
                        'falkenberg-himmelsblå': '#86cedf',
                        'falkenberg-kvällsblå': '#133E4D',
                        'falkenberg-havsvik': '#0f8c9d',
                        'falkenberg-buteljgrön': '#146647',
                        'falkenberg-ängsgrön': '#52ae32',
                        'falkenberg-olivgrön': '#739600',
                        'falkenberg-blåstång': '#77bfb3',
                        'falkenberg-vinbär': '#ab0d1f',
                        'falkenberg-höstblad': '#f06e4e',
                        'falkenberg-magenta': '#e6007e',
                        'falkenberg-pion': '#f4a9af',
                        'falkenberg-havtorn': '#f39200',
                        'falkenberg-gul': '#ffd000',
                        'falkenberg-ingefära': '#ebe24e',
                        'falkenberg-stål': '#3d405b',
                        'falkenberg-syren': '#a899ff',
                        'falkenberg-hasselnöt': '#995626',
                        'falkenberg-lila': '#a03c78',
                        'falkenberg-korall': '#f0827d',
                        'falkenberg-mörkgrå': '#414042',
                        'falkenberg-ljusgrå': '#e6e7e8',
                    },
                    fontFamily: {
                        'montserrat': ['Montserrat', 'sans-serif'],
                        'lato': ['Lato', 'sans-serif'],
                    }
                }
            }
        }
    </script>
    <style>
        body {
            font-family: 'Lato', sans-serif;
        }

        h1, h2, h3, h4, h5, h6 {
            font-family: 'Montserrat', sans-serif;
        }

        .slide {
            height: 100vh;
            display: none;
            scroll-snap-align: start;
            position: relative;
        }

        .slide-logo {
            position: absolute;
            bottom: 2rem;
            right: 2rem;
            width: 180px;
            height: auto;
            z-index: 10;
        }

        .slide.active {
            display: flex;
        }

        @page {
            size: 1920px 1080px;
            margin: 0;
        }

        @media print {
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }

            html, body {
                margin: 0 !important;
                padding: 0 !important;
                width: 1920px !important;
                height: auto !important;
            }

            #slides-container {
                display: block !important;
                width: 1920px !important;
            }

            .slide {
                display: flex !important;
                page-break-after: always !important;
                page-break-inside: avoid !important;
                break-after: page !important;
                break-inside: avoid !important;
                width: 1920px !important;
                height: 1080px !important;
                min-height: 1080px !important;
                max-height: 1080px !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                position: relative !important;
                overflow: hidden !important;
            }

            .slide:last-child {
                page-break-after: avoid !important;
            }

            .navigation, .fixed, button {
                display: none !important;
            }

            .shadow-xl, .shadow-lg, .shadow-md, .shadow {
                box-shadow: none !important;
            }

            .shadow-xl {
                border: 1px solid rgba(0, 0, 0, 0.1) !important;
            }
        }
    </style>
</head>
<body class="bg-gray-50">
    <!-- Navigation Controls -->
    <div class="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex gap-4">
        <button id="prev-btn" class="bg-white hover:bg-gray-100 text-gray-800 px-6 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all">
            <i data-lucide="chevron-left" class="w-6 h-6"></i>
        </button>
        <button id="next-btn" class="bg-white hover:bg-gray-100 text-gray-800 px-6 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all">
            <i data-lucide="chevron-right" class="w-6 h-6"></i>
        </button>
    </div>

    <!-- Slide Counter -->
    <div class="fixed top-8 right-8 z-50 bg-white px-4 py-2 rounded-full shadow-md text-sm font-medium text-gray-700">
        <span id="current-slide">1</span> / <span id="total-slides">0</span>
    </div>

    <!-- Slides Container -->
    <div id="slides-container">
        ${cleanedSections.join('\n')}
    </div>

    <script>
      (function () {
        let currentSlide = 0;
        let slides = [];

        function initSlides() {
          slides = Array.from(document.querySelectorAll('.slide'));
          const totalEl = document.getElementById('total-slides');
          if (totalEl) totalEl.textContent = String(slides.length);

          if (slides.length > 0) {
            showSlide(0);
          }
        }

        function showSlide(n) {
          if (!slides || slides.length === 0) return;

          slides.forEach(slide => slide.classList.remove('active'));

          if (n >= slides.length) n = 0;
          if (n < 0) n = slides.length - 1;

          currentSlide = n;
          slides[currentSlide].classList.add('active');

          const currentEl = document.getElementById('current-slide');
          if (currentEl) currentEl.textContent = String(currentSlide + 1);

          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        }

        function nextSlide() {
          showSlide(currentSlide + 1);
        }

        function prevSlide() {
          showSlide(currentSlide - 1);
        }

        document.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault();
            nextSlide();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevSlide();
          }
        });

        window.addEventListener('DOMContentLoaded', () => {
          const nextBtn = document.getElementById('next-btn');
          const prevBtn = document.getElementById('prev-btn');

          nextBtn?.addEventListener('click', nextSlide);
          prevBtn?.addEventListener('click', prevSlide);

          initSlides();
        });
      })();
    </script>
</body>
</html>`;
}

/**
 * Generate a title slide
 */
export function generateTitleSlide(title: string, subtitle?: string, date?: string): string {
  const displayDate = date || new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<section id="slide-title" class="slide bg-gradient-to-br from-falkenberg-kommunblå to-falkenberg-marinblå items-center justify-center">
    <img src="https://kommun.falkenberg.se/document/om-kommunen/grafisk-profil/kommunens-logotyper/liggande-logotyper-foer-tryck/1610-falkenbergskommun-logo-vit-ligg"
         alt="Falkenbergs kommun" class="slide-logo">
    <div class="text-center text-white px-16">
        <h1 class="text-7xl font-bold mb-6">${title}</h1>
        ${subtitle ? `<p class="text-3xl font-light mb-8">${subtitle}</p>` : ''}
        <p class="text-xl font-light opacity-80">${displayDate}</p>
    </div>
</section>`;
}

/**
 * Generate a thank you slide
 */
export function generateThankYouSlide(): string {
  return `<section id="slide-thankyou" class="slide bg-gradient-to-br from-falkenberg-ängsgrön to-falkenberg-havsvik items-center justify-center">
    <img src="https://kommun.falkenberg.se/document/om-kommunen/grafisk-profil/kommunens-logotyper/liggande-logotyper-foer-tryck/1610-falkenbergskommun-logo-vit-ligg"
         alt="Falkenbergs kommun" class="slide-logo">
    <div class="text-center text-white px-16">
        <h1 class="text-7xl font-bold mb-6">Tack!</h1>
        <p class="text-3xl font-light">Frågor?</p>
    </div>
</section>`;
}
