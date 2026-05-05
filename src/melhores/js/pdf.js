import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatNumber } from './utils.js';

const PDF_CATEGORIES = [
  { key: 'exercicio', label: 'Exercício Físico', icon: '💪' },
  { key: 'familia', label: 'Família', icon: '👨‍👩‍👧‍👦' },
  { key: 'alimentacao', label: 'Alimentação', icon: '🥗' },
  { key: 'hobbies', label: 'Hobbies', icon: '🎨' },
  { key: 'conhecimentos', label: 'Conhecimentos', icon: '📚' },
  { key: 'bestWeek', label: 'Best of The Week', icon: '🌟' },
];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getPdfElements() {
  return {
    container: document.getElementById('pdf-report-container'),
    dateRange: document.getElementById('pdf-date-range-text'),
    overallWinner: document.getElementById('pdf-overall-winner'),
    categoryChampions: document.getElementById('pdf-category-champions'),
  };
}

function buildChampionMarkup(category, participant) {
  if (!participant) {
    return `
      <article class="pdf-champion-card">
        <span class="pdf-champion-chip">${category.icon} ${escapeHtml(category.label)}</span>
        <div class="pdf-champion-empty">Sem campeão definido</div>
      </article>
    `;
  }

  const points = Number(participant.categories?.[category.key] || 0);

  return `
    <article class="pdf-champion-card">
      <span class="pdf-champion-chip">${category.icon} ${escapeHtml(category.label)}</span>
      <strong class="pdf-champion-name">${escapeHtml(participant.name)}</strong>
      <span class="pdf-champion-score">${formatNumber(points)} pts</span>
    </article>
  `;
}

function buildOverallWinnerMarkup(participant) {
  if (!participant) {
    return `
      <div class="pdf-overall-kicker">Melhor dos melhores</div>
      <div class="pdf-overall-empty">Nenhum participante disponível.</div>
    `;
  }

  return `
    <div class="pdf-overall-kicker">Melhor dos melhores</div>
    <div class="pdf-overall-title">${escapeHtml(participant.name)}</div>
    <div class="pdf-overall-score">${formatNumber(participant.totalPoints || 0)} pts</div>
    <div class="pdf-overall-caption">Maior pontuação no Ranking Geral de Pontos</div>
  `;
}

export async function generatePDF(rankings, contextLabel = 'Rodada atual') {
  const button = document.getElementById('download-pdf-btn');
  const btnText = button?.querySelector('.btn-text');
  const originalText = btnText?.textContent || 'PDF';
  const generalRanking = rankings?.geral || [];

  if (!generalRanking.length) {
    alert('Ainda não há participantes suficientes para gerar o PDF.');
    return;
  }

  if (button) button.disabled = true;
  if (btnText) btnText.textContent = 'Gerando...';

  try {
    const {
      container,
      dateRange,
      overallWinner,
      categoryChampions,
    } = getPdfElements();

    if (!container || !dateRange || !overallWinner || !categoryChampions) {
      throw new Error('Estrutura do relatório PDF não encontrada no DOM.');
    }

    dateRange.textContent = contextLabel;
    overallWinner.innerHTML = buildOverallWinnerMarkup(generalRanking[0]);
    categoryChampions.innerHTML = PDF_CATEGORIES
      .map((category) => buildChampionMarkup(category, rankings?.[category.key]?.[0] || null))
      .join('');

    container.style.zIndex = '9999';
    container.style.top = '0';
    container.style.left = '0';

    await new Promise((resolve) => window.setTimeout(resolve, 250));

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#1E4DD1',
    });

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const imgData = canvas.toDataURL('image/png');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`Amplify_Melhores_${Date.now()}.pdf`);
  } catch (error) {
    console.error('Failed to generate PDF:', error);
    alert('Ocorreu um erro ao gerar o PDF. Tente novamente.');
  } finally {
    const { container } = getPdfElements();
    if (container) {
      container.style.zIndex = '-100';
      container.style.top = '-9999px';
      container.style.left = '-9999px';
    }

    if (button) button.disabled = false;
    if (btnText) btnText.textContent = originalText;
  }
}
