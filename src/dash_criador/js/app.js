import {
  COMPARISON_OPTIONS,
  DATE_PRESET_OPTIONS,
  WEEKLY_GOAL_METRICS,
  getCreatorHubSnapshot,
  getDefaultFilters,
  saveCalendarInterest,
  saveFormSubmission,
  saveWeeklyGoal,
  saveProfileUpdate,
  getTikTokShopSnapshot,
} from './data.js';
import { renderContentMixChart, renderPerformanceChart, renderWeeklyGoalsChart } from './charts.js';
import {
  buildWhatsAppUrl,
  copyText,
  escapeHtml,
  formatCompactNumber,
  formatCurrencyBR,
  formatDateBR,
  formatDateTimeBR,
  formatNumber,
  formatPercent,
  formatRatio,
  getInitials,
} from './utils.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const DEFAULT_SECTION = 'overview';
const SECTION_IDS = new Set(['overview', 'goals', 'projects', 'calendar', 'forms', 'profile']);

const state = {
  filters: getDefaultFilters(),
  snapshot: null,
  activeModal: null,
  refreshTimer: null,
  weeklyMetricKey: 'gmv',
  activeProjectId: null,
  activeCalendarEventId: null,
  activeSection: DEFAULT_SECTION,
  ttSubtab: 'tt-overview',
  ttFilters: { period: 'last_7_days', brand: 'all', product: 'all', campaign: 'all', contentType: 'all' },
  ttSnapshot: null,
  ttSortKey: 'revenue',
  ttSortDir: 'desc',
  ttVideoSortKey: 'revenue',
  ttVideoSortDir: 'desc',
  ttCharts: {},
};

function init() {
  populateControls();
  syncControls();
  bindEvents();
  initializeSectionNavigation();
  refreshSnapshot(true);
  initTikTokShop();
}

function populateControls() {
  populateSelect($('#date-preset-select'), DATE_PRESET_OPTIONS);
  populateSelect($('#comparison-select'), COMPARISON_OPTIONS);
}

function populateSelect(element, options) {
  if (!element) return;
  element.innerHTML = options
    .map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`)
    .join('');
}

function syncControls() {
  const presetEl = $('#date-preset-select');
  if (!presetEl) return;
  presetEl.value = state.filters.preset;
  const compEl = $('#comparison-select');
  if (compEl) compEl.value = state.filters.comparison;
  const csEl = $('#custom-range-start');
  if (csEl) csEl.value = state.filters.customStart;
  const ceEl = $('#custom-range-end');
  if (ceEl) ceEl.value = state.filters.customEnd;
  updateCustomRangeVisibility();
}

function bindEvents() {
  $('#date-preset-select')?.addEventListener('change', (event) => {
    state.filters.preset = event.target.value;
    updateCustomRangeVisibility();

    if (state.filters.preset === 'custom') {
      const currentPeriod = state.snapshot?.period;
      if (!state.filters.customStart && currentPeriod) {
        state.filters.customStart = currentPeriod.start;
      }

      if (!state.filters.customEnd && currentPeriod) {
        state.filters.customEnd = currentPeriod.end;
      }

      syncControls();

      if (state.filters.customStart && state.filters.customEnd) {
        refreshSnapshot();
      }

      return;
    }

    refreshSnapshot();
  });

  $('#custom-range-start')?.addEventListener('change', (event) => {
    state.filters.customStart = event.target.value;
    maybeRefreshCustomRange();
  });

  $('#custom-range-end')?.addEventListener('change', (event) => {
    state.filters.customEnd = event.target.value;
    maybeRefreshCustomRange();
  });

  $('#comparison-select')?.addEventListener('change', (event) => {
    state.filters.comparison = event.target.value;
    refreshSnapshot();
  });

  $$('[data-open-modal]').forEach((button) => {
    button.addEventListener('click', () => openModal(button.dataset.openModal));
  });

  $$('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });

  $$('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = $(button.dataset.scrollTarget);
      const sectionId = target?.closest('[data-view]')?.dataset.view || target?.dataset.section || target?.id;

      if (sectionId && SECTION_IDS.has(sectionId)) {
        setActiveSection(sectionId, { updateHash: true, scroll: true });
        return;
      }

      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $$('.nav-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const sectionId = sanitizeSectionId(link.getAttribute('href')?.replace('#', ''));
      setActiveSection(sectionId, { updateHash: true, scroll: true });
    });
  });

  $('#copy-summary-btn')?.addEventListener('click', handleCopySummary);
  $('#quick-request-form')?.addEventListener('submit', handleQuickRequestSubmit);
  $('#anonymous-report-form')?.addEventListener('submit', handleAnonymousReportSubmit);
  $('#nps-form')?.addEventListener('submit', handleNpsSubmit);
  $('#profile-form')?.addEventListener('submit', handleProfileSubmit);

  $$('.score-button', $('#nps-score-grid')).forEach((button) => {
    button.addEventListener('click', () => selectNpsScore(button.dataset.score));
  });

  document.addEventListener('submit', (event) => {
    if (event.target?.id === 'weekly-goal-form') {
      handleWeeklyGoalSubmit(event);
    }
  });

  document.addEventListener('click', (event) => {
    const metricButton = event.target.closest('[data-weekly-metric]');
    if (!metricButton) {
      const projectButton = event.target.closest('[data-project-open]');
      if (projectButton) {
        state.activeProjectId = projectButton.dataset.projectOpen;
        renderProjects();
        return;
      }

      const calendarButton = event.target.closest('[data-calendar-open]');
      if (calendarButton) {
        state.activeCalendarEventId = calendarButton.dataset.calendarOpen;
        renderCalendar();
        return;
      }

      const interestButton = event.target.closest('[data-calendar-interest]');
      if (interestButton) {
        const response = saveCalendarInterest(interestButton.dataset.calendarInterest);
        refreshSnapshot(true);
        showToast(
          response.created ? 'Interesse registrado' : 'Participação já registrada',
          response.created
            ? 'O evento foi marcado na sua agenda do portal.'
            : 'Esse evento já está marcado no seu portal.',
        );
      }

      return;
    }

    state.weeklyMetricKey = metricButton.dataset.weeklyMetric;
    renderWeeklyGoalHistory();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeModal) {
      closeModal();
    }
  });
}

function maybeRefreshCustomRange() {
  if (state.filters.preset !== 'custom') {
    return;
  }

  if (!state.filters.customStart || !state.filters.customEnd) {
    $('#loading-status-text').textContent = 'Selecione início e fim para aplicar o intervalo personalizado';
    return;
  }

  refreshSnapshot();
}

function updateCustomRangeVisibility() {
  const customFields = $('#custom-range-fields');
  if (!customFields) return;
  const isCustom = state.filters.preset === 'custom';
  customFields.hidden = !isCustom;
}

function refreshSnapshot(immediate = false) {
  const loadingEl = $('#analytics-loading');
  if (loadingEl) showLoading('Recalculando métricas');
  window.clearTimeout(state.refreshTimer);

  state.refreshTimer = window.setTimeout(() => {
    state.snapshot = getCreatorHubSnapshot(state.filters);
    renderAll();
    hideLoading();
  }, immediate ? 0 : 120);
}

function renderAll() {
  syncModuleSelections();
  applySectionVisibility(state.activeSection);
  renderControlMeta();
  renderHero();
  renderMetrics();
  renderPerformanceChart(
    state.snapshot.analytics.chartSeries,
    state.snapshot.analytics.compareChartSeries,
    state.snapshot.period.comparisonLabel,
  );
  renderContentMixChart(state.snapshot.analytics.contentMix);
  renderBestVideos();
  renderComparisonInsights();
  renderBreakdownTable();
  renderWeeklyGoals();
  renderWeeklyGoalHistory();
  renderProjects();
  renderCalendar();
  renderSubmissions();
  renderProfile();
}

function syncModuleSelections() {
  const projectItems = state.snapshot?.projects?.items || [];
  const calendarEvents = state.snapshot?.calendar?.events || [];

  if (!projectItems.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = projectItems[0]?.id ?? null;
  }

  const defaultEventId = state.snapshot?.calendar?.upcoming?.[0]?.id ?? calendarEvents[0]?.id ?? null;

  if (!calendarEvents.some((event) => event.id === state.activeCalendarEventId)) {
    state.activeCalendarEventId = defaultEventId;
  }
}

function renderControlMeta() {
  const { period } = state.snapshot;
  const el = $('#active-period-label');
  if (el) el.textContent = `${period.label} · ${period.absoluteLabel}`;
  const copy = $('#active-period-copy');
  if (copy) copy.textContent = `${period.comparisonLabel} · ${period.granularityLabel}`;
  const badge = $('#granularity-badge');
  if (badge) badge.textContent = period.granularityLabel;
  const pill = $('#hero-period-pill');
  if (pill) pill.textContent = period.label;
}

function renderHero() {
  const { creator, accountManager, period, analytics } = state.snapshot;
  const avatarEl = $('#creator-avatar-image');
  if (!avatarEl) return;
  avatarEl.src = creator.avatarUrl || '';
  avatarEl.alt = creator.avatarUrl
    ? `Foto de perfil de ${creator.fullName}`
    : 'Foto da creator';
  avatarEl.hidden = !creator.avatarUrl;
  const heroName = $('#hero-name');
  if (heroName) heroName.textContent = creator.fullName;
  const heroHandle = $('#hero-handle');
  if (heroHandle) heroHandle.textContent = creator.handle;
  const heroSegment = $('#hero-segment');
  if (heroSegment) heroSegment.textContent = creator.segment;
  const heroCity = $('#hero-city');
  if (heroCity) heroCity.textContent = creator.city;
  const heroFocus = $('#hero-focus');
  if (heroFocus) heroFocus.textContent = creator.focus;

  const mgrAvatar = $('#manager-avatar');
  if (mgrAvatar) mgrAvatar.textContent = getInitials(accountManager.name);
  const mgrName = $('#manager-name');
  if (mgrName) mgrName.textContent = accountManager.name;
  const mgrRole = $('#manager-role');
  if (mgrRole) mgrRole.textContent = accountManager.role;
  const mgrCoverage = $('#manager-coverage');
  if (mgrCoverage) mgrCoverage.textContent = accountManager.coverage;
  const mgrMeeting = $('#manager-meeting');
  if (mgrMeeting) mgrMeeting.textContent = formatDateTimeBR(accountManager.meetingAt);

  const mailLink = `mailto:${accountManager.email}`;
  const message = `Oi, ${accountManager.name.split(' ')[0]}! Preciso de apoio com a operação no Creator Hub.`;
  const mgrEmail = $('#manager-email');
  if (mgrEmail) mgrEmail.href = mailLink;
  const mgrWA = $('#manager-whatsapp');
  if (mgrWA) mgrWA.href = buildWhatsAppUrl(accountManager.phone, message);

  const sidebarName = $('#sidebar-manager-name');
  if (sidebarName) sidebarName.textContent = accountManager.name;
  const sidebarRole = $('#sidebar-manager-role');
  if (sidebarRole) sidebarRole.textContent = accountManager.role;
  const sidebarEmail = $('#sidebar-manager-email');
  if (sidebarEmail) { sidebarEmail.href = mailLink; sidebarEmail.textContent = accountManager.email; }
}

function renderMetrics() {
  const container = $('#metric-grid');
  if (!container) {
    return;
  }

  container.innerHTML = state.snapshot.analytics.metricCards
    .map((metric) => {
      const comparePillLabel = getComparePillLabel(metric);
      const value = formatMetricValue(metric.format, metric.value);
      const highlightClass = metric.highlight ? 'metric-card--highlight' : '';

      return `
        <article class="metric-card ${highlightClass}">
          <div>
            <span class="metric-label">${escapeHtml(metric.label)}</span>
            <strong class="metric-value">${escapeHtml(value)}</strong>
          </div>

          <div class="metric-compare">
            <span class="metric-compare-pill tone-${metric.tone}">${escapeHtml(comparePillLabel)}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderBestVideos() {
  const container = $('#best-videos-list');
  if (!container) return;
  const videos = state.snapshot.analytics.bestVideos;

  if (!videos.length) {
    container.innerHTML = buildEmptyState(
      'Sem vídeos suficientes no período',
      'Selecione uma janela com publicações ou conversões atribuídas para visualizar os melhores criativos.',
    );
    return;
  }

  container.innerHTML = videos
    .map(
      (video, index) => `
        <article class="video-card">
          <div class="video-head">
            <div class="video-rank">#${index + 1}</div>
            <div>
              <h5 class="video-title">${escapeHtml(video.title)}</h5>
              <p class="video-platform">${escapeHtml(video.platform)} · Publicado em ${escapeHtml(
                formatDateBR(`${video.publishedAt}T12:00:00`),
              )}</p>
            </div>
          </div>

          <div class="video-metrics">
            <div class="video-stat">
              <span class="detail-label">Impressões</span>
              <strong>${escapeHtml(formatCompactNumber(video.impressions))}</strong>
            </div>
            <div class="video-stat">
              <span class="detail-label">Receita</span>
              <strong>${escapeHtml(formatCurrencyBR(video.revenue))}</strong>
            </div>
            <div class="video-stat">
              <span class="detail-label">ROAS</span>
              <strong>${escapeHtml(formatRatio(video.roas))}</strong>
            </div>
          </div>
        </article>
      `,
    )
    .join('');
}

function renderComparisonInsights() {
  const container = $('#comparison-insights');
  if (!container) return;

  container.innerHTML = state.snapshot.analytics.comparisonInsights
    .map(
      (item) => `
        <article class="compare-card">
          <span class="compare-chip">${escapeHtml(item.title)}</span>
          <strong class="compare-value">${escapeHtml(item.value)}</strong>
        </article>
      `,
    )
    .join('');
}

function renderBreakdownTable() {
  const tbody = $('#analytics-tbody');
  if (!tbody) return;
  const rows = state.snapshot.analytics.breakdownRows;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">${buildInlineEmptyCopy()}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td><p class="table-title">${escapeHtml(row.label)}</p></td>
          <td>${escapeHtml(formatNumber(row.impressions))}</td>
          <td>${escapeHtml(formatNumber(row.clicks))}</td>
          <td>${escapeHtml(formatNumber(row.conversions))}</td>
          <td>${escapeHtml(formatCurrencyBR(row.cost, true))}</td>
          <td>${escapeHtml(formatCurrencyBR(row.revenue))}</td>
          <td>${escapeHtml(formatPercent(row.ctr, 2))}</td>
          <td>${escapeHtml(formatCurrencyBR(row.cpc, true))}</td>
          <td>${escapeHtml(formatCurrencyBR(row.cpa, true))}</td>
          <td>${escapeHtml(formatRatio(row.roas))}</td>
        </tr>
      `,
    )
    .join('');
}

function renderWeeklyGoals() {
  const {
    weeklyGoals: { onboarding, activeCycle, previousCycle, cycles, comparison, alerts },
  } = state.snapshot;

  renderWeeklyGoalOnboarding(onboarding, activeCycle);
  renderWeeklyGoalFocus(activeCycle, previousCycle);
  renderWeeklyAlerts(alerts, activeCycle);
  renderWeeklyGoalCards(cycles);
  renderWeeklyComparison(comparison);
}

function renderWeeklyGoalOnboarding(onboarding, activeCycle) {
  const container = $('#weekly-goal-onboarding-panel');
  if (!container) {
    return;
  }

  if (onboarding.isVisible) {
    container.innerHTML = `
      <div>
        <p class="panel-kicker">Onboarding rápido</p>
        <h4 class="goal-onboarding-title">Defina suas metas da semana em 30 segundos</h4>
      </div>

      <div class="goal-onboarding-meta">
        <span class="goal-meta-pill">${escapeHtml(formatDateBR(`${onboarding.startDate}T12:00:00`))} - ${escapeHtml(
          formatDateBR(`${onboarding.endDate}T12:00:00`),
        )}</span>
        <span class="goal-meta-pill">Timezone do creator respeitado</span>
        <span class="goal-meta-pill">Janela fixa de 7 dias</span>
        <span class="goal-meta-pill">Meta travada após salvar</span>
      </div>

      <form class="goal-form" id="weekly-goal-form">
        <div class="goal-form-grid">
          ${WEEKLY_GOAL_METRICS.map(
            (metric) => `
              <label class="field">
                <span>${escapeHtml(metric.label)}</span>
                <input
                  name="${metric.key}"
                  type="number"
                  min="${metric.inputMin}"
                  step="${metric.inputStep}"
                  value="${escapeHtml(onboarding.defaults[metric.key])}"
                  required
                />
              </label>
            `,
          ).join('')}
        </div>

        <div class="form-actions">
          <button class="button button-primary" type="submit">Salvar metas da semana</button>
        </div>
      </form>
    `;

    return;
  }

  container.innerHTML = `
    <div>
      <p class="panel-kicker">Metas travadas</p>
      <h4 class="goal-onboarding-title">A semana atual já está configurada</h4>
    </div>

    <div class="goal-onboarding-meta">
      <span class="goal-meta-pill">Início ${escapeHtml(formatDateBR(`${activeCycle.startDate}T12:00:00`))}</span>
      <span class="goal-meta-pill">Fim ${escapeHtml(formatDateBR(`${activeCycle.endDate}T12:00:00`))}</span>
      <span class="goal-meta-pill">Travada em ${escapeHtml(formatDateTimeBR(activeCycle.lockedAt))}</span>
    </div>

    <div class="goal-card-grid">
      ${activeCycle.progressByMetric
        .map(
          (metric) => `
            <article class="goal-card-metric">
              <span>${escapeHtml(metric.label)}</span>
              <strong>${escapeHtml(formatMetricValue(metric.format, metric.target))}</strong>
            </article>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderWeeklyGoalFocus(activeCycle, previousCycle) {
  const container = $('#weekly-goal-focus-panel');
  if (!container) {
    return;
  }

  const cycle = activeCycle || previousCycle;

  if (!cycle) {
    container.innerHTML = buildEmptyState(
      'Nenhum ciclo semanal disponível',
      'Assim que a primeira meta for criada, o acompanhamento contínuo e o score aparecem aqui.',
    );
    return;
  }

  const statusClass = getGoalStatusClass(cycle.status);
  const scoreClass = getScoreLevelClass(cycle.level);
  const daysMeta =
    cycle.status === 'ativa'
      ? `${formatNumber(cycle.elapsedDays)} de ${formatNumber(cycle.totalDays)} dias corridos`
      : `Ciclo fechado em ${formatNumber(cycle.totalDays)} dias`;

  const compareHighlight =
    cycle.comparison?.find((item) => item.key === 'gmv') ??
    cycle.comparison?.[0] ??
    null;

  container.innerHTML = `
    <div class="goal-focus-head">
      <div>
        <p class="panel-kicker">${activeCycle ? 'Semana atual' : 'Última semana fechada'}</p>
        <h4 class="goal-focus-title">${escapeHtml(cycle.periodLabel)}</h4>
      </div>

      <span class="goal-status-pill ${statusClass}">${escapeHtml(cycle.status)}</span>
    </div>

    <div class="goal-focus-meta">
      <span class="goal-meta-pill">${escapeHtml(daysMeta)}</span>
      <span class="goal-meta-pill">${escapeHtml(compareHighlight ? buildWeeklyComparisonLabel(compareHighlight) : 'Sem base comparativa')}</span>
      ${activeCycle ? `<span class="goal-meta-pill">${escapeHtml(`${formatNumber(cycle.daysLeft)} dia(s) restantes`)}</span>` : ''}
    </div>

    <div class="goal-score-row">
      <div class="goal-progress-list">
        ${cycle.progressByMetric.map(buildGoalProgressItem).join('')}
      </div>

      <aside class="goal-score-card">
        <span class="detail-label">Score semanal</span>
        <strong class="goal-score-value">${escapeHtml(formatNumber(Math.round(cycle.score)))}</strong>
        <span class="score-pill ${scoreClass}">${escapeHtml(cycle.level)}</span>
      </aside>
    </div>
  `;
}

function renderWeeklyAlerts(alerts, activeCycle) {
  const container = $('#weekly-alerts');
  if (!container) {
    return;
  }

  if (!activeCycle) {
    container.innerHTML = buildEmptyState(
      'Aguardando meta da semana',
      'Quando o creator abrir um novo ciclo, os alertas automáticos de ritmo, fechamento e meta batida aparecem aqui.',
    );
    return;
  }

  if (!alerts.length) {
    container.innerHTML = `
      <article class="alert-card">
        <div><h5 class="alert-title">Ritmo saudável no momento</h5></div>
        <span class="alert-pill alert-success">Tudo sob controle</span>
      </article>
    `;
    return;
  }

  container.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card">
          <div><h5 class="alert-title">${escapeHtml(alert.title)}</h5></div>
          <span class="alert-pill ${getAlertClass(alert.type)}">${escapeHtml(getAlertLabel(alert.type))}</span>
        </article>
      `,
    )
    .join('');
}

function renderWeeklyGoalCards(cycles) {
  const container = $('#weekly-goal-cards');
  if (!container) {
    return;
  }

  if (!cycles.length) {
    container.innerHTML = buildEmptyState(
      'Sem histórico semanal ainda',
      'O histórico começa a ser montado automaticamente assim que os ciclos são registrados.',
    );
    return;
  }

  container.innerHTML = cycles
    .map(
      (cycle) => `
        <article class="panel goal-card">
          <div class="goal-card-head">
            <div>
              <p class="panel-kicker">${cycle.isCurrentWindow ? 'Ciclo em andamento' : 'Ciclo fechado'}</p>
              <h4 class="goal-card-title">${escapeHtml(cycle.periodLabel)}</h4>
            </div>
            <span class="goal-status-pill ${getGoalStatusClass(cycle.status)}">${escapeHtml(cycle.status)}</span>
          </div>

          <div class="goal-card-grid">
            ${cycle.progressByMetric
              .map(
                (metric) => `
                  <article class="goal-card-metric">
                    <span>${escapeHtml(metric.shortLabel)}</span>
                    <strong>${escapeHtml(
                      `${formatMetricValue(metric.format, metric.actual)} / ${formatMetricValue(metric.format, metric.target)} · ${formatPercent(metric.progress, 0)}`,
                    )}</strong>
                  </article>
                `,
              )
              .join('')}
          </div>
        </article>
      `,
    )
    .join('');
}

function renderWeeklyComparison(comparison) {
  const label = $('#weekly-compare-reference');
  const container = $('#weekly-compare-list');

  if (!label || !container) {
    return;
  }

  if (!comparison?.items?.length) {
    label.textContent = 'Sem comparação';
    container.innerHTML = buildEmptyState(
      'Comparação liberada ao abrir a semana',
      'Assim que o ciclo atual estiver ativo, o dashboard compara automaticamente a evolução com a semana imediatamente anterior.',
    );
    return;
  }

  label.textContent = comparison.referenceLabel;
  container.innerHTML = comparison.items
    .map(
      (item) => `
        <article class="goal-compare-card">
          <div class="goal-compare-head">
            <strong>${escapeHtml(item.label)}</strong>
            <span class="metric-compare-pill ${getCompareToneClass(item.absolute)}">${escapeHtml(buildWeeklyComparisonPercent(item.percent))}</span>
          </div>
          <div class="goal-progress-values">
            <span class="goal-progress-status">Semana atual</span>
            <strong class="goal-compare-value">${escapeHtml(formatMetricValue(item.format, item.current))}</strong>
          </div>
          <div class="goal-progress-values">
            <span class="goal-progress-status">Semana anterior</span>
            <strong class="goal-compare-value">${escapeHtml(formatMetricValue(item.format, item.previous))}</strong>
          </div>
        </article>
      `,
    )
    .join('');
}

function renderWeeklyGoalHistory() {
  const tabsContainer = $('#weekly-metric-tabs');
  const history = state.snapshot?.weeklyGoals?.history;

  if (!tabsContainer || !history) {
    return;
  }

  const availableKeys = Object.keys(history.metrics || {});
  if (!availableKeys.length) {
    tabsContainer.innerHTML = '';
    renderWeeklyGoalsChart([], null);
    return;
  }

  if (!availableKeys.includes(state.weeklyMetricKey)) {
    state.weeklyMetricKey = history.defaultMetric || availableKeys[0];
  }

  tabsContainer.innerHTML = WEEKLY_GOAL_METRICS.map(
    (metric) => `
      <button
        class="metric-tab ${metric.key === state.weeklyMetricKey ? 'is-active' : ''}"
        type="button"
        data-weekly-metric="${metric.key}"
      >
        ${escapeHtml(metric.shortLabel)}
      </button>
    `,
  ).join('');

  const selectedMetric = WEEKLY_GOAL_METRICS.find((metric) => metric.key === state.weeklyMetricKey) || WEEKLY_GOAL_METRICS[0];
  const series = history.metrics[state.weeklyMetricKey] || [];
  renderWeeklyGoalsChart(series, selectedMetric);
}

function buildGoalProgressItem(metric) {
  return `
    <article class="goal-progress-item">
      <div class="goal-progress-head">
        <h5 class="goal-progress-title">${escapeHtml(metric.label)}</h5>
        <span class="goal-progress-status">${escapeHtml(metric.status)}</span>
      </div>

      <div class="goal-progress-values">
        <span class="goal-progress-status">${escapeHtml(`${formatMetricValue(metric.format, metric.actual)} realizado`)}</span>
        <strong class="goal-progress-value">${escapeHtml(`${formatMetricValue(metric.format, metric.target)} meta`)}</strong>
      </div>

      <div class="goal-progress-track">
        <span
          class="goal-progress-fill ${getGoalProgressClass(metric.status)}"
          style="--progress: ${Math.min(metric.cappedProgress, 100)}%;"
        ></span>
      </div>

      <div class="goal-progress-values">
        <span class="goal-progress-status">${escapeHtml(buildGoalProgressLabel(metric))}</span>
        <strong class="goal-progress-value">${escapeHtml(formatPercent(metric.progress, 0))}</strong>
      </div>
    </article>
  `;
}

function renderProjects() {
  const summaryGrid = $('#project-summary-grid');
  const list = $('#project-list');
  const detailPanel = $('#project-detail-panel');
  const { projects } = state.snapshot;

  if (!summaryGrid || !list || !detailPanel) {
    return;
  }

  summaryGrid.innerHTML = projects.summary
    .map(
      (item) => `
        <article class="summary-card">
          <span class="summary-label">${escapeHtml(item.label)}</span>
          <strong class="summary-value">${escapeHtml(formatNumber(item.value))}</strong>
        </article>
      `,
    )
    .join('');

  if (!projects.items.length) {
    list.innerHTML = buildEmptyState(
      'Nenhum projeto vinculado',
      'Quando houver campanhas ligadas à creator, elas aparecem aqui com status e pendências.',
    );
    detailPanel.innerHTML = buildEmptyState(
      'Nenhum detalhe disponível',
      'Selecione um projeto para visualizar entregas, responsável e links úteis.',
    );
    return;
  }

  const activeProject =
    projects.items.find((project) => project.id === state.activeProjectId) ||
    projects.items[0];

  list.innerHTML = projects.items
    .map(
      (project) => `
        <button
          class="project-card ${project.id === activeProject.id ? 'is-active' : ''}"
          type="button"
          data-project-open="${project.id}"
        >
          <div class="project-card-head">
            <div>
              <h4 class="project-card-title">${escapeHtml(project.name)}</h4>
              <p class="project-card-subtitle">${escapeHtml(project.brand)} · ${escapeHtml(project.contractPeriodLabel)}</p>
            </div>
            <span class="status-chip ${getProjectStatusClass(project.status)}">${escapeHtml(project.status)}</span>
          </div>

          <div class="project-progress-head">
            <span class="project-progress-label">${escapeHtml(project.alertLabel)}</span>
            <strong class="project-progress-value">${escapeHtml(
              `${formatNumber(project.creatorDeliveredVideos)} / ${formatNumber(project.creatorContractedVideos)}`,
            )}</strong>
          </div>

          <div class="project-progress-track">
            <span class="project-progress-fill ${getProjectAlertClass(project.alertTone)}" style="--progress: ${project.progress}%;"></span>
          </div>

          <div class="project-card-footer">
            <span class="project-alert ${getProjectAlertClass(project.alertTone)}">${escapeHtml(project.alertLabel)}</span>
            <span class="project-meta-chip">${escapeHtml(
              project.nextPendingDelivery ? `Próxima: ${formatDateBR(project.nextPendingDelivery.dueAt)}` : 'Sem pendências',
            )}</span>
          </div>
        </button>
      `,
    )
    .join('');

  detailPanel.innerHTML = `
    <div class="project-detail-head">
      <div>
        <p class="panel-kicker">Detalhe do projeto</p>
        <h4 class="panel-title">${escapeHtml(activeProject.fullName)}</h4>
      </div>
      <span class="status-chip ${getProjectStatusClass(activeProject.status)}">${escapeHtml(activeProject.status)}</span>
    </div>

    <div class="project-detail-meta">
      <div class="detail-item">
        <span class="detail-label">Marca</span>
        <strong class="detail-value">${escapeHtml(activeProject.brand)}</strong>
      </div>
      <div class="detail-item">
        <span class="detail-label">Contrato</span>
        <strong class="detail-value">${escapeHtml(activeProject.contractPeriodLabel)}</strong>
      </div>
      <div class="detail-item">
        <span class="detail-label">Responsável</span>
        <strong class="detail-value">${escapeHtml(activeProject.responsibleName)}</strong>
      </div>
    </div>

    <div class="project-detail-banner">
      <strong class="project-banner-title">${escapeHtml(activeProject.alertLabel)}</strong>
      <span class="project-banner-copy">${escapeHtml(
        `${formatNumber(activeProject.creatorDeliveredVideos)} entregues de ${formatNumber(activeProject.creatorContractedVideos)} contratados`,
      )}</span>
      <div class="project-progress-track project-progress-track--detail">
        <span class="project-progress-fill ${getProjectAlertClass(activeProject.alertTone)}" style="--progress: ${activeProject.progress}%;"></span>
      </div>
    </div>

    <div class="delivery-list">
      ${activeProject.deliveries
        .map(
          (delivery) => `
            <article class="delivery-item">
              <div>
                <h5 class="delivery-title">${escapeHtml(delivery.title)}</h5>
                <p class="delivery-copy">${escapeHtml(delivery.objective)}</p>
              </div>
              <div class="delivery-meta">
                <span class="status-chip ${getDeliveryStatusClass(delivery.status)}">${escapeHtml(delivery.status)}</span>
                <span class="delivery-date">${escapeHtml(formatDateTimeBR(delivery.dueAt))}</span>
              </div>
            </article>
          `,
        )
        .join('')}
    </div>

    <div class="detail-links">
      <a class="button button-secondary" href="${escapeHtml(activeProject.projectUrl)}" target="_blank" rel="noreferrer">Projeto</a>
      <a class="button button-secondary" href="${escapeHtml(activeProject.squadUrl)}" target="_blank" rel="noreferrer">Squad</a>
      <a class="button button-secondary" href="mailto:${escapeHtml(activeProject.responsibleEmail)}">Responsável</a>
      ${
        activeProject.contractLink
          ? `<a class="button button-secondary" href="${escapeHtml(activeProject.contractLink)}" target="_blank" rel="noreferrer">Contrato</a>`
          : '<span class="detail-link-disabled">Contrato pendente</span>'
      }
    </div>
  `;
}

function renderCalendar() {
  const categoryBadge = $('#calendar-category-badge');
  const monthLabel = $('#calendar-month-label');
  const calendarGrid = $('#calendar-grid');
  const upcomingList = $('#calendar-upcoming-list');
  const detailPanel = $('#calendar-detail-panel');
  const { calendar, projects } = state.snapshot;

  if (!categoryBadge || !monthLabel || !calendarGrid || !upcomingList || !detailPanel) {
    return;
  }

  categoryBadge.textContent = calendar.categoryLabel;
  monthLabel.textContent = capitalizeLabel(calendar.month.label);

  calendarGrid.innerHTML = calendar.month.days
    .map(
      (day) => `
        <article class="calendar-day ${day.isCurrentMonth ? '' : 'is-muted'} ${day.isToday ? 'is-today' : ''}">
          <span class="calendar-day-number">${escapeHtml(String(day.dayNumber))}</span>
          <div class="calendar-day-events">
            ${day.events
              .map(
                (event) => `
                  <button
                    class="calendar-event-pill ${getEventTypeClass(event.type)} ${getEventTimingClass(event.timingState)}"
                    type="button"
                    data-calendar-open="${event.id}"
                  >
                    <span class="calendar-event-time">${escapeHtml(formatTimeLabel(event.startsAt))}</span>
                    <span class="calendar-event-name">${escapeHtml(event.shortTitle)}</span>
                  </button>
                `,
              )
              .join('')}
            ${day.extraCount ? `<span class="calendar-more-events">+${day.extraCount}</span>` : ''}
          </div>
        </article>
      `,
    )
    .join('');

  if (!calendar.upcoming.length) {
    upcomingList.innerHTML = buildEmptyState(
      'Sem eventos próximos',
      'Quando a agenda da creator receber novos eventos ou prazos de projeto, eles aparecem aqui.',
    );
    detailPanel.innerHTML = buildEmptyState(
      'Sem evento selecionado',
      'Escolha um evento do calendário para visualizar objetivo, links e participação.',
    );
    return;
  }

  const activeEvent =
    calendar.events.find((event) => event.id === state.activeCalendarEventId) ||
    calendar.upcoming[0];
  const linkedProject = projects.items.find((project) => project.id === activeEvent.projectId) || null;

  upcomingList.innerHTML = calendar.upcoming
    .map(
      (event) => `
        <article class="upcoming-event-card ${event.id === activeEvent.id ? 'is-active' : ''}">
          <div class="upcoming-event-head">
            <span class="event-type-pill ${getEventTypeClass(event.type)}">${escapeHtml(event.typeLabel)}</span>
            <span class="event-timing-pill ${getEventTimingClass(event.timingState)}">${escapeHtml(getEventTimingLabel(event.timingState))}</span>
          </div>
          <button class="upcoming-event-button" type="button" data-calendar-open="${event.id}">
            <strong class="upcoming-event-title">${escapeHtml(event.title)}</strong>
            <span class="upcoming-event-meta">${escapeHtml(formatEventWindow(event))}</span>
            ${
              event.projectName
                ? `<span class="upcoming-event-project">${escapeHtml(event.projectName)}</span>`
                : ''
            }
          </button>
        </article>
      `,
    )
    .join('');

  detailPanel.innerHTML = `
    <div class="event-detail-head">
      <div>
        <p class="panel-kicker">Detalhe do evento</p>
        <h4 class="panel-title">${escapeHtml(activeEvent.title)}</h4>
      </div>
      <div class="event-detail-pills">
        <span class="event-type-pill ${getEventTypeClass(activeEvent.type)}">${escapeHtml(activeEvent.typeLabel)}</span>
        <span class="event-timing-pill ${getEventTimingClass(activeEvent.timingState)}">${escapeHtml(getEventTimingLabel(activeEvent.timingState))}</span>
      </div>
    </div>

    <div class="event-detail-meta">
      <div class="detail-item">
        <span class="detail-label">Quando</span>
        <strong class="detail-value">${escapeHtml(formatEventWindow(activeEvent))}</strong>
      </div>
      <div class="detail-item">
        <span class="detail-label">Marca</span>
        <strong class="detail-value">${escapeHtml(activeEvent.brand || 'Amplify')}</strong>
      </div>
      <div class="detail-item">
        <span class="detail-label">Projeto</span>
        <strong class="detail-value">${escapeHtml(linkedProject?.name || 'Evento geral')}</strong>
      </div>
    </div>

    <div class="event-detail-grid">
      <article class="detail-copy-card">
        <span class="detail-label">Objetivo</span>
        <strong class="detail-copy-title">${escapeHtml(activeEvent.objective || 'Sem objetivo cadastrado')}</strong>
      </article>
      <article class="detail-copy-card">
        <span class="detail-label">Descrição</span>
        <strong class="detail-copy-title">${escapeHtml(activeEvent.description || 'Sem descrição adicional')}</strong>
      </article>
    </div>

    <div class="detail-links">
      <button
        class="button ${activeEvent.interestRegistered ? 'button-secondary' : 'button-primary'}"
        type="button"
        data-calendar-interest="${activeEvent.id}"
      >
        ${activeEvent.interestRegistered ? 'Interesse registrado' : 'Participar'}
      </button>
      ${
        activeEvent.meetingUrl
          ? `<a class="button button-secondary" href="${escapeHtml(activeEvent.meetingUrl)}" target="_blank" rel="noreferrer">Zoom / Meet</a>`
          : '<span class="detail-link-disabled">Link ao vivo no dia</span>'
      }
      ${
        activeEvent.recordingUrl
          ? `<a class="button button-secondary" href="${escapeHtml(activeEvent.recordingUrl)}" target="_blank" rel="noreferrer">Gravação</a>`
          : ''
      }
      ${
        activeEvent.materialsUrl
          ? `<a class="button button-secondary" href="${escapeHtml(activeEvent.materialsUrl)}" target="_blank" rel="noreferrer">Materiais</a>`
          : ''
      }
      ${
        linkedProject?.projectUrl
          ? `<a class="button button-secondary" href="${escapeHtml(linkedProject.projectUrl)}" target="_blank" rel="noreferrer">Projeto</a>`
          : ''
      }
    </div>
  `;
}

function renderSubmissions() {
  const container = $('#submission-log');
  const submissions = state.snapshot.submissions;

  if (!submissions.length) {
    container.innerHTML = buildEmptyState(
      'Nenhum envio no período',
      'Quando houver solicitações, denúncias ou NPS dentro da janela ativa, elas aparecerão aqui.',
    );
    return;
  }

  container.innerHTML = submissions
    .map(
      (entry) => `
        <article class="activity-item">
          <div class="activity-head">
            <div>
              <h5 class="video-title">${escapeHtml(entry.title)}</h5>
              <p class="activity-time">${escapeHtml(formatDateTimeBR(entry.createdAt))}</p>
            </div>
            <span class="status-chip ${getSubmissionStatusClass(entry.status)}">${escapeHtml(entry.status)}</span>
          </div>
          <p class="panel-copy">${escapeHtml(entry.summary)}</p>
        </article>
      `,
    )
    .join('');
}

function renderProfile() {
  const profileDetails = $('#profile-details');
  const syncPill = $('#sync-pill');
  const syncNoteTime = $('#sync-note-time');
  const { profile, sync } = state.snapshot;

  const fields = [
    ['Nome completo', profile.fullName],
    ['Instagram', profile.instagram],
    ['E-mail', profile.email],
    ['WhatsApp', profile.phone],
    ['Cidade', profile.city],
    ['Nicho', profile.niche],
    ['Endereço para envio', profile.shippingAddress],
    ['Chave Pix', profile.pixKey || 'Não informado'],
    ['Preferência de contato', profile.contactPreference],
    ['Observações', profile.notes || 'Sem observações adicionais.'],
  ];

  profileDetails.innerHTML = fields
    .map(
      ([label, value]) => `
        <dl class="profile-item">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </dl>
      `,
    )
    .join('');

  syncPill.textContent = sync.label;
  syncNoteTime.textContent = sync.lastUpdatedAt
    ? `Última atualização enviada em ${formatDateTimeBR(sync.lastUpdatedAt)}.`
    : 'Nenhuma atualização recente.';

  Object.entries(profile).forEach(([key, value]) => {
    const field = $('#profile-form')?.elements.namedItem(key);
    if (field) {
      field.value = value ?? '';
    }
  });
}

function handleQuickRequestSubmit(event) {
  event.preventDefault();
  const payload = normalizeFormData(event.currentTarget);
  saveFormSubmission('quick-request', payload);
  event.currentTarget.reset();
  closeModal();
  refreshSnapshot(true);
  showToast('Solicitação registrada', 'Seu pedido entrou na fila operacional e já respeita o filtro global atual.');
}

function handleAnonymousReportSubmit(event) {
  event.preventDefault();
  const payload = normalizeFormData(event.currentTarget);
  saveFormSubmission('anonymous-report', payload);
  event.currentTarget.reset();
  closeModal();
  refreshSnapshot(true);
  showToast('Relato confidencial enviado', 'O registro foi salvo com trilha confidencial e aparece no período correspondente.');
}

function handleNpsSubmit(event) {
  event.preventDefault();
  const payload = normalizeFormData(event.currentTarget);

  if (!payload.score) {
    showToast('Escolha uma nota', 'Selecione uma nota de 0 a 10 antes de enviar o NPS.');
    return;
  }

  saveFormSubmission('nps', payload);
  event.currentTarget.reset();
  selectNpsScore('');
  closeModal();
  refreshSnapshot(true);
  showToast('NPS recebido', 'A percepção do creator foi registrada e entra na timeline do período atual.');
}

function handleProfileSubmit(event) {
  event.preventDefault();
  const payload = normalizeFormData(event.currentTarget);
  saveProfileUpdate(payload);
  refreshSnapshot(true);
  showToast('Atualização enviada', 'O cadastro foi atualizado e o payload ficou pronto para a automação futura com o Notion.');
}

function handleWeeklyGoalSubmit(event) {
  event.preventDefault();
  const payload = normalizeFormData(event.currentTarget);
  const response = saveWeeklyGoal(payload);

  if (!response.created) {
    showToast('Meta já ativa', 'Este ciclo semanal já foi configurado e permanece bloqueado até o fechamento.');
    refreshSnapshot(true);
    return;
  }

  refreshSnapshot(true);
  showToast('Metas da semana criadas', 'O ciclo semanal foi aberto e o acompanhamento contínuo já começou com comparação automática.');
}

async function handleCopySummary() {
  if (!state.snapshot) {
    return;
  }

  const { analytics, creator, accountManager, period, weeklyGoals } = state.snapshot;
  const metrics = Object.fromEntries(analytics.metricCards.map((metric) => [metric.key, metric]));
  const weeklySummary = weeklyGoals.activeCycle
    ? `Metas semanais: ${weeklyGoals.activeCycle.periodLabel} · Score ${formatNumber(Math.round(weeklyGoals.activeCycle.score))} · ${weeklyGoals.activeCycle.level}`
    : null;
  const activeProject = state.snapshot.projects.items.find((project) => project.id === state.activeProjectId) || state.snapshot.projects.items[0];
  const nextEvent = state.snapshot.calendar.upcoming[0] || null;

  const summary = [
    `Amplify Creator Hub · ${creator.fullName}`,
    `Período: ${period.label} (${period.absoluteLabel})`,
    `Comparação: ${period.comparisonLabel}`,
    `Impressões: ${formatMetricValue(metrics.impressions.format, metrics.impressions.value)}`,
    `Cliques: ${formatMetricValue(metrics.clicks.format, metrics.clicks.value)}`,
    `Conversões: ${formatMetricValue(metrics.conversions.format, metrics.conversions.value)}`,
    `Custo: ${formatMetricValue(metrics.cost.format, metrics.cost.value)}`,
    `Receita: ${formatMetricValue(metrics.revenue.format, metrics.revenue.value)}`,
    `ROAS: ${formatMetricValue(metrics.roas.format, metrics.roas.value)}`,
    weeklySummary,
    activeProject ? `Projeto ativo: ${activeProject.name} · ${activeProject.alertLabel}` : null,
    nextEvent ? `Próximo evento: ${nextEvent.title} · ${formatEventWindow(nextEvent)}` : null,
    `Account Manager: ${accountManager.name} · ${accountManager.email}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await copyText(summary);
    showToast('Resumo copiado', 'O snapshot do creator foi copiado para a área de transferência.');
  } catch {
    showToast('Não foi possível copiar', 'Tente novamente em alguns segundos.');
  }
}

function normalizeFormData(form) {
  return Object.fromEntries(
    Array.from(new FormData(form).entries()).map(([key, value]) => [key, String(value).trim()]),
  );
}

function openModal(name) {
  const layer = $('#modal-layer');
  const cards = $$('[data-modal]');

  state.activeModal = name;
  layer.hidden = false;
  document.body.style.overflow = 'hidden';

  cards.forEach((card) => {
    card.hidden = card.dataset.modal !== name;
  });
}

function closeModal() {
  const layer = $('#modal-layer');
  if (!layer) {
    return;
  }

  state.activeModal = null;
  layer.hidden = true;
  document.body.style.overflow = '';
}

function selectNpsScore(score) {
  $('#nps-score').value = score;

  $$('.score-button', $('#nps-score-grid')).forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.score === score);
  });
}

function initializeSectionNavigation() {
  window.addEventListener('hashchange', handleHashChange);
  setActiveSection(DEFAULT_SECTION, {
    updateHash: true,
    replaceHistory: true,
    scroll: false,
    force: true,
  });
}

function handleHashChange() {
  setActiveSection(sanitizeSectionId(window.location.hash.replace('#', '')), {
    updateHash: false,
    scroll: false,
  });
}

function sanitizeSectionId(sectionId) {
  return SECTION_IDS.has(sectionId) ? sectionId : DEFAULT_SECTION;
}

function setActiveSection(
  sectionId,
  { updateHash = false, replaceHistory = false, scroll = false, force = false } = {},
) {
  const nextSection = sanitizeSectionId(sectionId);
  const nextHash = `#${nextSection}`;

  if (!force && state.activeSection === nextSection && (!updateHash || window.location.hash === nextHash)) {
    return;
  }

  state.activeSection = nextSection;
  applySectionVisibility(nextSection);
  setActiveNavLink(nextSection);

  if (updateHash) {
    const method = replaceHistory ? 'replaceState' : 'pushState';
    window.history[method](null, '', nextHash);
  }

  if (scroll) {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }
}

function applySectionVisibility(sectionId) {
  $$('[data-view]').forEach((view) => {
    view.hidden = view.dataset.view !== sectionId;
  });
}

function setActiveNavLink(sectionId) {
  $$('.nav-link').forEach((link) => {
    const target = link.getAttribute('href')?.replace('#', '');
    const isActive = target === sectionId;
    link.classList.toggle('is-active', isActive);

    if (isActive) {
      link.setAttribute('aria-current', 'page');
      return;
    }

    link.removeAttribute('aria-current');
  });
}

function showLoading(message) {
  const el = $('#analytics-loading');
  if (!el) return;
  el.hidden = false;
  const txt = $('#loading-status-text');
  if (txt) txt.textContent = `${message}...`;
}

function hideLoading() {
  const el = $('#analytics-loading');
  if (!el) return;
  el.hidden = true;
  const txt = $('#loading-status-text');
  if (txt) txt.textContent = 'Dados prontos para análise';
}

function showToast(title, message) {
  const stack = $('#toast-stack');
  if (!stack) {
    return;
  }

  const toast = document.createElement('article');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
  stack.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 4200);
}

function buildEmptyState(title, copy) {
  return `
    <article class="empty-state">
      <h5 class="empty-state-title">${escapeHtml(title)}</h5>
      <p class="empty-state-copy">${escapeHtml(copy)}</p>
    </article>
  `;
}

function buildInlineEmptyCopy(copy = 'Nenhum dado encontrado para o período selecionado.') {
  return `<div class="empty-state"><p class="empty-state-copy">${escapeHtml(copy)}</p></div>`;
}

function formatMetricValue(format, value) {
  switch (format) {
    case 'currency':
      return formatCurrencyBR(value);
    case 'currency-decimal':
      return formatCurrencyBR(value, true);
    case 'hours':
      return `${Number(value || 0).toFixed(1).replace('.', ',')}h`;
    case 'percent':
      return formatPercent(value, 2);
    case 'ratio':
      return formatRatio(value);
    case 'number':
    default:
      return formatNumber(value);
  }
}

function getComparePillLabel(metric) {
  if (metric.previousValue == null) {
    return 'Sem comparação';
  }

  if (metric.deltaPercent == null) {
    return 'Sem base anterior';
  }

  const prefix = metric.deltaPercent > 0 ? '+' : '';
  return `${prefix}${metric.deltaPercent.toFixed(1).replace('.', ',')}%`;
}

function formatDeltaAbsolute(format, value) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  const absolute = Math.abs(value);

  if (format === 'currency' || format === 'currency-decimal') {
    return `${prefix}${formatCurrencyBR(absolute, format === 'currency-decimal')}`;
  }

  if (format === 'percent') {
    return `${prefix}${formatPercent(absolute, 2)}`;
  }

  if (format === 'hours') {
    return `${prefix}${Number(absolute || 0).toFixed(1).replace('.', ',')}h`;
  }

  if (format === 'ratio') {
    return `${prefix}${formatRatio(absolute)}`;
  }

  return `${prefix}${formatNumber(absolute)}`;
}

function buildGoalProgressLabel(metric) {
  return `${formatMetricValue(metric.format, metric.actual)} de ${formatMetricValue(metric.format, metric.target)}`;
}

function buildWeeklyComparisonLabel(metric) {
  const direction = metric.absolute > 0 ? 'acima' : metric.absolute < 0 ? 'abaixo' : 'em linha com';
  return `${metric.shortLabel} ${direction} a semana anterior`;
}

function buildWeeklyComparisonPercent(value) {
  if (value == null) {
    return 'Sem base';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1).replace('.', ',')}%`;
}

function formatEventWindow(event) {
  if (!event?.startsAt) {
    return 'Sem horário definido';
  }

  if (!event.endsAt || event.endsAt === event.startsAt) {
    return formatDateTimeBR(event.startsAt);
  }

  return `${formatDateBR(event.startsAt)} · ${formatTimeLabel(event.startsAt)} - ${formatTimeLabel(event.endsAt)}`;
}

function formatTimeLabel(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function capitalizeLabel(value = '') {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function buildWeeklyComparisonCopy(metric) {
  const difference = formatDeltaAbsolute(metric.format, metric.absolute);

  if (metric.percent == null) {
    return `${difference} contra a semana anterior, ainda sem base percentual estável para esta métrica.`;
  }

  return `${difference} vs semana anterior, equivalente a ${buildWeeklyComparisonPercent(metric.percent)}.`;
}

function getGoalStatusClass(status) {
  if (status === 'concluída') {
    return 'status-won';
  }

  if (status === 'não atingida') {
    return 'status-missed';
  }

  return 'status-active';
}

function getScoreLevelClass(level) {
  if (level === 'Elite') {
    return 'score-elite';
  }

  if (level === 'Forte') {
    return 'score-strong';
  }

  if (level === 'Regular') {
    return 'score-regular';
  }

  return 'score-low';
}

function getGoalProgressClass(status) {
  if (status === 'Meta batida') {
    return 'status-above';
  }

  if (status === 'Quase lá') {
    return 'status-mid';
  }

  return 'status-low';
}

function getAlertClass(type) {
  if (type === 'success') {
    return 'alert-success';
  }

  if (type === 'warning') {
    return 'alert-warning';
  }

  return 'alert-info';
}

function getAlertLabel(type) {
  if (type === 'success') {
    return 'Meta batida';
  }

  if (type === 'warning') {
    return 'Atenção';
  }

  return 'Lembrete';
}

function getCompareToneClass(value) {
  if (value > 0) {
    return 'tone-positive';
  }

  if (value < 0) {
    return 'tone-negative';
  }

  return 'tone-neutral';
}

function getStatusClass(status) {
  if (status === 'Aprovado' || status === 'Entregue') {
    return status === 'Entregue' ? 'status-delivered' : 'status-approved';
  }

  if (status === 'Em rota') {
    return 'status-transit';
  }

  if (status === 'Em análise') {
    return 'status-review';
  }

  if (status === 'Aguardando estoque') {
    return 'status-pending';
  }

  return 'status-blocked';
}

function getProjectStatusClass(status) {
  if (status === 'Fechamento') {
    return 'status-approved';
  }

  if (status === 'Entrega') {
    return 'status-review';
  }

  if (status === 'Execução') {
    return 'status-transit';
  }

  if (status === 'Onboarding') {
    return 'status-pending';
  }

  return 'status-blocked';
}

function getProjectAlertClass(tone) {
  if (tone === 'success') {
    return 'status-approved';
  }

  if (tone === 'neutral') {
    return 'status-transit';
  }

  return 'status-blocked';
}

function getDeliveryStatusClass(status) {
  return status === 'Entregue' ? 'status-approved' : 'status-blocked';
}

function getEventTypeClass(type) {
  if (type === 'Treinamento Mentora') {
    return 'type-mentora';
  }

  if (type === 'Treinamento Marca') {
    return 'type-brand';
  }

  if (type === 'Evento') {
    return 'type-event';
  }

  if (type === 'Reunião') {
    return 'type-meeting';
  }

  return 'type-project';
}

function getEventTimingClass(timingState) {
  if (timingState === 'live') {
    return 'timing-live';
  }

  if (timingState === 'soon') {
    return 'timing-soon';
  }

  if (timingState === 'done') {
    return 'timing-done';
  }

  return 'timing-scheduled';
}

function getEventTimingLabel(timingState) {
  if (timingState === 'live') {
    return 'Em andamento';
  }

  if (timingState === 'soon') {
    return 'Próximas 24h';
  }

  if (timingState === 'done') {
    return 'Encerrado';
  }

  return 'Agendado';
}

function getSubmissionStatusClass(status) {
  if (status === 'Confidencial') {
    return 'status-blocked';
  }

  if (status === 'Em andamento') {
    return 'status-review';
  }

  return 'status-approved';
}

// ============================================================
// TIKTOK SHOP ANALYTICS MODULE
// ============================================================

function initTikTokShop() {
  populateTTFilters();
  bindTTEvents();
  refreshTTSnapshot();
}

function populateTTFilters() {
  const snap = getTikTokShopSnapshot();
  const brandSel = $('#tt-brand-select');
  const productSel = $('#tt-product-select');
  const campaignSel = $('#tt-campaign-select');
  const contentSel = $('#tt-content-type-select');

  if (brandSel) {
    brandSel.innerHTML = '<option value="all">Todas as marcas</option>' +
      snap.brands.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  }
  if (productSel) {
    productSel.innerHTML = '<option value="all">Todos os produtos</option>' +
      snap.products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }
  if (campaignSel) {
    campaignSel.innerHTML = '<option value="all">Todas as campanhas</option>' +
      snap.campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }
  if (contentSel) {
    contentSel.innerHTML = '<option value="all">Todos os tipos</option>' +
      snap.contentTypes.map(t => `<option value="${t}">${escapeHtml(t)}</option>`).join('');
  }
}

function bindTTEvents() {
  // Sub-tab navigation
  $$('.tt-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.ttSubtab = btn.dataset.subtab;
      $$('.tt-subtab').forEach(b => b.classList.toggle('is-active', b === btn));
      $$('[data-subpage]').forEach(p => {
        p.hidden = p.dataset.subpage !== state.ttSubtab;
      });
      renderTTCurrentTab();
    });
  });

  // Filters
  $('#tt-period-select')?.addEventListener('change', e => { state.ttFilters.period = e.target.value; refreshTTSnapshot(); });
  $('#tt-brand-select')?.addEventListener('change', e => { state.ttFilters.brand = e.target.value; refreshTTSnapshot(); });
  $('#tt-product-select')?.addEventListener('change', e => { state.ttFilters.product = e.target.value; refreshTTSnapshot(); });
  $('#tt-campaign-select')?.addEventListener('change', e => { state.ttFilters.campaign = e.target.value; refreshTTSnapshot(); });
  $('#tt-content-type-select')?.addEventListener('change', e => { state.ttFilters.contentType = e.target.value; refreshTTSnapshot(); });

  // Product table sort
  $$('#tt-product-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.ttSortKey === key) state.ttSortDir = state.ttSortDir === 'desc' ? 'asc' : 'desc';
      else { state.ttSortKey = key; state.ttSortDir = 'desc'; }
      renderTTProductTable();
    });
  });

  // Video table sort
  $$('#tt-video-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.ttVideoSortKey === key) state.ttVideoSortDir = state.ttVideoSortDir === 'desc' ? 'asc' : 'desc';
      else { state.ttVideoSortKey = key; state.ttVideoSortDir = 'desc'; }
      renderTTVideoTable();
    });
  });

  // Search
  $('#tt-product-search')?.addEventListener('input', () => renderTTProductTable());
  $('#tt-video-search')?.addEventListener('input', () => renderTTVideoTable());
}

function refreshTTSnapshot() {
  state.ttSnapshot = getTikTokShopSnapshot(state.ttFilters);
  renderTTAll();
}

function renderTTAll() {
  renderTTKPIs();
  renderTTCurrentTab();
}

function renderTTCurrentTab() {
  if (state.ttSubtab === 'tt-overview') {
    renderTTOverviewCharts();
    renderTTTopProductsRanking();
  } else if (state.ttSubtab === 'tt-products') {
    renderTTProductTable();
    renderTTProductCharts();
  } else if (state.ttSubtab === 'tt-content') {
    renderTTVideoTable();
    renderTTContentCharts();
    renderTTTopVideosRanking();
  } else if (state.ttSubtab === 'tt-insights') {
    renderTTInsights();
    renderTTHeatmap();
  }
}

function renderTTKPIs() {
  const container = $('#tt-kpi-grid');
  if (!container || !state.ttSnapshot) return;
  const k = state.ttSnapshot.kpis;

  const cards = [
    { label: 'Receita Total', value: formatCurrencyBR(k.revenue.value), delta: k.revenue.delta },
    { label: 'GMV Total', value: formatCurrencyBR(k.gmv.value), delta: k.gmv.delta },
    { label: 'Pedidos', value: formatNumber(k.pedidos.value), delta: k.pedidos.delta },
    { label: 'AOV', value: formatCurrencyBR(k.aov.value, true), delta: k.aov.delta },
    { label: 'CVR M\u00e9dio', value: formatPercent(k.cvr.value, 1), delta: k.cvr.delta },
    { label: 'RPM M\u00e9dio', value: `R$ ${k.rpm.value.toFixed(2).replace('.', ',')}`, delta: k.rpm.delta },
  ];

  container.innerHTML = cards.map(c => {
    const deltaClass = c.delta == null ? 'is-neutral' : c.delta > 0 ? 'is-positive' : c.delta < 0 ? 'is-negative' : 'is-neutral';
    const deltaLabel = c.delta == null ? '—' : `${c.delta > 0 ? '+' : ''}${c.delta.toFixed(1).replace('.', ',')}%`;
    return `
      <article class="tt-kpi-card">
        <span class="tt-kpi-label">${escapeHtml(c.label)}</span>
        <strong class="tt-kpi-value">${escapeHtml(c.value)}</strong>
        <span class="tt-kpi-delta ${deltaClass}">${escapeHtml(deltaLabel)}</span>
      </article>
    `;
  }).join('');
}

function renderTTOverviewCharts() {
  if (!state.ttSnapshot) return;
  const { dailyData, funnel, brandRevenue } = state.ttSnapshot;

  // Revenue & GMV line chart
  destroyChart('ttRevenue');
  const revCanvas = document.getElementById('tt-revenue-chart');
  if (revCanvas) {
    state.ttCharts.ttRevenue = new Chart(revCanvas, {
      type: 'line',
      data: {
        labels: dailyData.map(d => d.label),
        datasets: [
          { label: 'Receita', data: dailyData.map(d => d.revenue), borderColor: '#52d9a8', backgroundColor: 'rgba(82,217,168,0.1)', borderWidth: 3, pointRadius: 3, tension: 0.35, fill: true },
          { label: 'GMV', data: dailyData.map(d => d.gmv), borderColor: '#7ed7ff', backgroundColor: 'rgba(126,215,255,0.1)', borderWidth: 2, pointRadius: 2, tension: 0.35, borderDash: [6, 4] },
        ],
      },
      options: ttChartOptions({ y: { ticks: { callback: v => formatCompactNumber(v) } } }),
    });
  }

  // Funnel chart
  destroyChart('ttFunnel');
  const funnelCanvas = document.getElementById('tt-funnel-chart');
  if (funnelCanvas) {
    state.ttCharts.ttFunnel = new Chart(funnelCanvas, {
      type: 'bar',
      data: {
        labels: funnel.map(f => f.label),
        datasets: [{
          data: funnel.map(f => f.value),
          backgroundColor: ['rgba(128,166,255,0.5)', 'rgba(255,207,90,0.5)', 'rgba(82,217,168,0.5)'],
          borderRadius: 14, borderSkipped: false, maxBarThickness: 56,
        }],
      },
      options: { ...ttChartOptions(), indexAxis: 'y', plugins: { ...ttChartOptions().plugins, legend: { display: false } } },
    });
  }

  // Brand revenue chart
  destroyChart('ttBrand');
  const brandCanvas = document.getElementById('tt-brand-chart');
  if (brandCanvas) {
    state.ttCharts.ttBrand = new Chart(brandCanvas, {
      type: 'bar',
      data: {
        labels: brandRevenue.map(b => b.name),
        datasets: [{
          data: brandRevenue.map(b => b.revenue),
          backgroundColor: brandRevenue.map(b => b.color + '88'),
          borderColor: brandRevenue.map(b => b.color),
          borderWidth: 2, borderRadius: 14, borderSkipped: false, maxBarThickness: 44,
        }],
      },
      options: { ...ttChartOptions(), indexAxis: 'y', plugins: { ...ttChartOptions().plugins, legend: { display: false } } },
    });
  }
}

function renderTTTopProductsRanking() {
  const container = $('#tt-top-products-ranking');
  if (!container || !state.ttSnapshot) return;
  container.innerHTML = state.ttSnapshot.topProducts.map((p, i) => `
    <article class="tt-ranking-item">
      <div class="tt-ranking-position ${i < 3 ? `rank-${i + 1}` : 'rank-default'}">${i + 1}</div>
      <div class="tt-ranking-info">
        <span class="tt-ranking-name">${escapeHtml(p.name)}</span>
        <span class="tt-ranking-meta">${escapeHtml(p.brandName)} · RPM R$ ${p.rpm.toFixed(2).replace('.', ',')}</span>
      </div>
      <strong class="tt-ranking-value">${escapeHtml(formatCurrencyBR(p.revenue))}</strong>
    </article>
  `).join('');
}

function renderTTProductTable() {
  const tbody = $('#tt-product-tbody');
  if (!tbody || !state.ttSnapshot) return;
  const search = ($('#tt-product-search')?.value || '').toLowerCase();
  let rows = [...state.ttSnapshot.productRows];
  if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search) || r.brandName.toLowerCase().includes(search));
  rows.sort((a, b) => {
    const av = a[state.ttSortKey], bv = b[state.ttSortKey];
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return state.ttSortDir === 'desc' ? -cmp : cmp;
  });
  updateSortIndicators('#tt-product-table', state.ttSortKey, state.ttSortDir);

  tbody.innerHTML = rows.map(r => {
    const cvrDot = r.cvr > 3 ? 'alert-good' : r.cvr < 1 ? 'alert-bad' : 'alert-warn';
    const rpmDot = r.rpm > 3 ? 'alert-good' : r.rpm < 1 ? 'alert-bad' : 'alert-warn';
    return `<tr>
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td>${escapeHtml(r.brandName)}</td>
      <td>${escapeHtml(r.campaignName)}</td>
      <td>${escapeHtml(formatCompactNumber(r.views))}</td>
      <td>${escapeHtml(formatCompactNumber(r.clicks))}</td>
      <td>${escapeHtml(formatNumber(r.purchases))}</td>
      <td><strong>${escapeHtml(formatCurrencyBR(r.revenue))}</strong></td>
      <td>${escapeHtml(formatPercent(r.ctr, 1))}</td>
      <td><span class="tt-alert-dot ${cvrDot}"></span> ${escapeHtml(formatPercent(r.cvr, 1))}</td>
      <td><span class="tt-alert-dot ${rpmDot}"></span> R$ ${r.rpm.toFixed(2).replace('.', ',')}</td>
      <td>${escapeHtml(formatPercent(r.refundRate, 1))}</td>
    </tr>`;
  }).join('');
}

function renderTTProductCharts() {
  if (!state.ttSnapshot) return;
  const products = state.ttSnapshot.productRows.slice(0, 8);

  // Revenue bar
  destroyChart('ttProductRevenue');
  const rc = document.getElementById('tt-product-revenue-chart');
  if (rc) {
    state.ttCharts.ttProductRevenue = new Chart(rc, {
      type: 'bar',
      data: { labels: products.map(p => p.name.slice(0, 18)), datasets: [{ data: products.map(p => p.revenue), backgroundColor: 'rgba(82,217,168,0.5)', borderColor: '#52d9a8', borderWidth: 2, borderRadius: 12, borderSkipped: false }] },
      options: { ...ttChartOptions(), plugins: { ...ttChartOptions().plugins, legend: { display: false } } },
    });
  }

  // CVR bar
  destroyChart('ttProductCVR');
  const cc = document.getElementById('tt-product-cvr-chart');
  if (cc) {
    state.ttCharts.ttProductCVR = new Chart(cc, {
      type: 'bar',
      data: { labels: products.map(p => p.name.slice(0, 18)), datasets: [{ data: products.map(p => p.cvr), backgroundColor: 'rgba(255,207,90,0.5)', borderColor: '#ffcf5a', borderWidth: 2, borderRadius: 12, borderSkipped: false }] },
      options: { ...ttChartOptions(), plugins: { ...ttChartOptions().plugins, legend: { display: false } } },
    });
  }

  // Scatter
  destroyChart('ttScatter');
  const sc = document.getElementById('tt-scatter-chart');
  if (sc) {
    state.ttCharts.ttScatter = new Chart(sc, {
      type: 'scatter',
      data: { datasets: [{ label: 'Produtos', data: products.map(p => ({ x: p.views, y: p.revenue, label: p.name })), backgroundColor: products.map(p => p.brandColor + 'cc'), pointRadius: 8, pointHoverRadius: 12 }] },
      options: { ...ttChartOptions({ x: { title: { display: true, text: 'Views', color: 'rgba(248,251,255,0.5)' }, ticks: { callback: v => formatCompactNumber(v) } }, y: { title: { display: true, text: 'Receita (R$)', color: 'rgba(248,251,255,0.5)' }, ticks: { callback: v => formatCompactNumber(v) } } }), plugins: { ...ttChartOptions().plugins, legend: { display: false }, tooltip: { ...ttChartOptions().plugins.tooltip, callbacks: { label: ctx => `${products[ctx.dataIndex]?.name}: ${formatCurrencyBR(ctx.parsed.y)} · ${formatCompactNumber(ctx.parsed.x)} views` } } } },
    });
  }

  // RPM bar
  destroyChart('ttProductRPM');
  const rpc = document.getElementById('tt-product-rpm-chart');
  if (rpc) {
    state.ttCharts.ttProductRPM = new Chart(rpc, {
      type: 'bar',
      data: { labels: products.map(p => p.name.slice(0, 18)), datasets: [{ data: products.map(p => p.rpm), backgroundColor: 'rgba(128,166,255,0.5)', borderColor: '#80a6ff', borderWidth: 2, borderRadius: 12, borderSkipped: false }] },
      options: { ...ttChartOptions(), plugins: { ...ttChartOptions().plugins, legend: { display: false } } },
    });
  }
}

function renderTTVideoTable() {
  const tbody = $('#tt-video-tbody');
  if (!tbody || !state.ttSnapshot) return;
  const search = ($('#tt-video-search')?.value || '').toLowerCase();
  let rows = [...state.ttSnapshot.videos];
  if (search) rows = rows.filter(r => r.title.toLowerCase().includes(search) || r.productName.toLowerCase().includes(search));
  rows.sort((a, b) => {
    const av = a[state.ttVideoSortKey], bv = b[state.ttVideoSortKey];
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return state.ttVideoSortDir === 'desc' ? -cmp : cmp;
  });
  updateSortIndicators('#tt-video-table', state.ttVideoSortKey, state.ttVideoSortDir);

  tbody.innerHTML = rows.map(v => {
    const scoreClass = v.score >= 60 ? 'score-high' : v.score >= 35 ? 'score-mid' : 'score-low';
    return `<tr>
      <td><div class="tt-video-cell"><div class="tt-thumb" style="background:${v.brandColor}22;border:1px solid ${v.brandColor}44">🎥</div><span class="tt-video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span></div></td>
      <td>${escapeHtml(v.productName)}</td>
      <td><span class="tt-content-type">${escapeHtml(v.contentType)}</span></td>
      <td>${escapeHtml(formatCompactNumber(v.views))}</td>
      <td>${escapeHtml(formatPercent(v.ctr, 1))}</td>
      <td>${escapeHtml(formatPercent(v.cvr, 1))}</td>
      <td><strong>${escapeHtml(formatCurrencyBR(v.revenue))}</strong></td>
      <td>R$ ${v.rpm.toFixed(2).replace('.', ',')}</td>
      <td>${v.watchTime.toFixed(1).replace('.', ',')}s</td>
      <td>${escapeHtml(formatPercent(v.retention3s, 0))}</td>
      <td>${escapeHtml(formatPercent(v.retention5s, 0))}</td>
      <td><span class="tt-score-badge ${scoreClass}">${v.score}</span></td>
    </tr>`;
  }).join('');
}

function renderTTContentCharts() {
  if (!state.ttSnapshot) return;
  const videos = state.ttSnapshot.videos.slice(0, 10);

  // Retention chart
  destroyChart('ttRetention');
  const rc = document.getElementById('tt-retention-chart');
  if (rc) {
    const labels = ['0s', '3s', '5s', '10s', '15s', '30s'];
    const datasets = videos.slice(0, 5).map((v, i) => {
      const colors = ['#52d9a8', '#7ed7ff', '#ff6b9d', '#ffcf5a', '#80a6ff'];
      return {
        label: v.title.slice(0, 25),
        data: [100, v.retention3s, v.retention5s, v.retention5s * 0.7, v.retention5s * 0.45, v.retention5s * 0.2],
        borderColor: colors[i], backgroundColor: colors[i] + '18',
        borderWidth: 2, pointRadius: 3, tension: 0.4,
      };
    });
    state.ttCharts.ttRetention = new Chart(rc, { type: 'line', data: { labels, datasets }, options: ttChartOptions() });
  }

  // Content scatter (hook rate vs revenue)
  destroyChart('ttContentScatter');
  const sc = document.getElementById('tt-content-scatter-chart');
  if (sc) {
    state.ttCharts.ttContentScatter = new Chart(sc, {
      type: 'scatter',
      data: { datasets: [{ label: 'V\u00eddeos', data: videos.map(v => ({ x: v.retention3s, y: v.revenue })), backgroundColor: videos.map(v => v.brandColor + 'cc'), pointRadius: 7, pointHoverRadius: 11 }] },
      options: { ...ttChartOptions({ x: { title: { display: true, text: 'Hook Rate (Ret. 3s %)', color: 'rgba(248,251,255,0.5)' } }, y: { title: { display: true, text: 'Receita (R$)', color: 'rgba(248,251,255,0.5)' }, ticks: { callback: v => formatCompactNumber(v) } } }), plugins: { ...ttChartOptions().plugins, legend: { display: false } } },
    });
  }
}

function renderTTTopVideosRanking() {
  const container = $('#tt-top-videos-ranking');
  if (!container || !state.ttSnapshot) return;
  const top = state.ttSnapshot.videos.slice(0, 5);
  container.innerHTML = top.map((v, i) => `
    <article class="tt-ranking-item">
      <div class="tt-ranking-position ${i < 3 ? `rank-${i + 1}` : 'rank-default'}">${i + 1}</div>
      <div class="tt-ranking-info">
        <span class="tt-ranking-name">${escapeHtml(v.title)}</span>
        <span class="tt-ranking-meta">${escapeHtml(v.productName)} · ${escapeHtml(v.contentType)} · Score ${v.score}</span>
      </div>
      <strong class="tt-ranking-value">${escapeHtml(formatCurrencyBR(v.revenue))}</strong>
    </article>
  `).join('');
}

function renderTTInsights() {
  const container = $('#tt-insights-grid');
  if (!container || !state.ttSnapshot) return;
  container.innerHTML = state.ttSnapshot.insights.map(insight => `
    <article class="tt-insight-card type-${insight.type}">
      <span class="tt-insight-icon">${insight.icon}</span>
      <h5 class="tt-insight-title">${escapeHtml(insight.title)}</h5>
      <p class="tt-insight-detail">${escapeHtml(insight.detail)}</p>
    </article>
  `).join('');
}

function renderTTHeatmap() {
  const container = $('#tt-heatmap');
  if (!container || !state.ttSnapshot) return;
  const heatmap = state.ttSnapshot.heatmap;
  const maxVal = Math.max(...heatmap.map(h => h.value));
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'S\u00e1b'];
  const hours = [];
  for (let h = 6; h <= 23; h++) hours.push(`${String(h).padStart(2, '0')}h`);

  let html = '<div class="tt-heatmap-grid">';
  // Header row
  html += '<div class="tt-heatmap-label"></div>';
  hours.forEach(h => { html += `<div class="tt-heatmap-label">${h}</div>`; });
  // Data rows
  days.forEach((day, di) => {
    html += `<div class="tt-heatmap-label">${day}</div>`;
    for (let h = 6; h <= 23; h++) {
      const cell = heatmap.find(c => c.dayIndex === di && c.hour === h);
      const val = cell?.value || 0;
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const r = Math.round(15 + intensity * 67);
      const g = Math.round(53 + intensity * 164);
      const b = Math.round(149 + intensity * 106);
      const a = 0.2 + intensity * 0.8;
      html += `<div class="tt-heatmap-cell" style="background:rgba(${r},${g},${b},${a})" title="${day} ${String(h).padStart(2,'0')}:00 \u2014 ${val} vendas"></div>`;
    }
  });
  html += '</div>';
  container.innerHTML = html;
}

function ttChartOptions(scaleOverrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 18 } },
      tooltip: { backgroundColor: 'rgba(7,20,54,0.95)', titleColor: '#fff', bodyColor: 'rgba(255,255,255,0.88)', padding: 12, cornerRadius: 14 },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'rgba(248,251,255,0.78)' }, ...scaleOverrides.x },
      y: { beginAtZero: true, ...scaleOverrides.y },
    },
  };
}

function destroyChart(key) {
  if (state.ttCharts[key]) {
    state.ttCharts[key].destroy();
    state.ttCharts[key] = null;
  }
}

function updateSortIndicators(tableSelector, sortKey, sortDir) {
  $$(tableSelector + ' th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortKey) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

init();
