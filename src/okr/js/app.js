document.addEventListener('DOMContentLoaded', () => {
  // 1. Icons Initialization
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // 2. Slider Logic
  let currentSlideIndex = 0;
  const slides = document.querySelectorAll('.slide');
  const slideCounter = document.getElementById('slideCounter');
  const progressBar = document.getElementById('progressBar');

  function updateDeck() {
    slides.forEach((slide, index) => {
      if (index === currentSlideIndex) {
        slide.classList.add('active');
        // If it comes into view and has counters, animate them
        animateCountersInSlide(slide);
        // Reset or draw charts if needed
        if (slide.querySelector('canvas')) {
          initCharts();
        }
      } else {
        slide.classList.remove('active');
      }
    });
    
    // Update counter
    slideCounter.innerText = `${currentSlideIndex + 1} / ${slides.length}`;
    
    // Update progress bar
    const progress = ((currentSlideIndex) / (slides.length - 1)) * 100;
    progressBar.style.width = `${progress}%`;
  }

  window.nextSlide = function() {
    if (currentSlideIndex < slides.length - 1) {
      currentSlideIndex++;
      updateDeck();
    }
  };

  window.prevSlide = function() {
    if (currentSlideIndex > 0) {
      currentSlideIndex--;
      updateDeck();
    }
  };

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Space') {
      window.nextSlide();
    } else if (e.key === 'ArrowLeft') {
      window.prevSlide();
    }
  });

  // 3. Counter Animation (Only runs when slide is active)
  function animateCountersInSlide(slide) {
    const counters = slide.querySelectorAll('.counter');
    counters.forEach(counter => {
      // Avoid re-running if already done
      if (counter.classList.contains('animated')) return;
      
      const target = +counter.getAttribute('data-target');
      const duration = 1500;
      const step = target / (duration / 16);
      let current = 0;

      const updateCounter = () => {
        current += step;
        if (current < target) {
          counter.innerText = Math.ceil(current).toLocaleString('pt-BR');
          requestAnimationFrame(updateCounter);
        } else {
          counter.innerText = target.toLocaleString('pt-BR');
          counter.classList.add('animated');
        }
      };
      
      updateCounter();
    });
  }

  // 4. Charts setup (Chart.js)
  Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
  Chart.defaults.font.family = "'Outfit', sans-serif";
  Chart.defaults.font.size = 13;

  let acqChartInst = null;
  let salesChartInst = null;

  function initCharts() {
    const acqCtx = document.getElementById('chart-acq');
    const salesCtx = document.getElementById('chart-sales');

    if (acqCtx && !acqChartInst) {
      acqChartInst = new Chart(acqCtx, {
        type: 'doughnut',
        data: {
          labels: ['Meta Ads (87%)', 'Novos (10%)', 'Comunidade (3%)'],
          datasets: [{
            data: [209, 24, 7],
            backgroundColor: ['#1E4DD1', '#fbbf24', '#10b981'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: { responsive: true, cutout: '70%', plugins: { legend: { position: 'bottom' } } }
      });
    }

    if (salesCtx && !salesChartInst) {
      salesChartInst = new Chart(salesCtx, {
        type: 'bar',
        data: {
          labels: ['Maio', 'Junho'],
          datasets: [
            { label: 'Leads (Inbound)', data: [120, 195], backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 4 },
            { label: 'Faturamento (BRL 000)', data: [50, 80], backgroundColor: '#fbbf24', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }
  }

  // Initial call
  updateDeck();
});
