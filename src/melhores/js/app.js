/**
 * app.js — Main application entry point (/melhores)
 */

import {
  addParticipant,
  createSnapshot,
  deleteSnapshot,
  getCategorizedRankings,
  getParticipantsData,
  getSnapshots,
  getSourceInfo,
  getWeeklyFactHistory,
  loadParticipantsData,
  persistVotingSession,
  reportParticipantObjective,
  recordWeeklyFactHistory,
  removeParticipant,
  restoreSnapshot,
  resetAllScores,
  updateParticipantObjectives,
  updateParticipantProfile,
  updateParticipantScores,
  VAR_REPORT_THRESHOLD,
} from './data.js';
import { generatePDF } from './pdf.js';
import { getInitials } from './utils.js';
import { CATEGORY_DEFINITIONS } from './shared.js';

const $ = (sel) => document.querySelector(sel);

let currentCategoryIndex = 0;
let currentParticipantIndex = 0;
let currentQueue = [];
let currentVoterIndex = 0;
let sessionResults = {};
let botwVotes = {};
let botwStep = 'SPEAKING';
let bestWinnerId = null;
let worstWinnerId = null;
let pendingWeeklyFactEntry = null;
let pendingRetryIntervalId = null;
let navigationHistory = [];

const CATEGORIES_ORDER = CATEGORY_DEFINITIONS;

const SFX = {
  win: new Audio('https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3'),
  shame: new Audio('https://assets.mixkit.co/active_storage/sfx/2436/2436-preview.mp3'),
};

Object.entries(SFX).forEach(([key, audio]) => {
  audio.load();
  audio.volume = 0.6;
  audio.oncanplaythrough = () => console.log(`Audio SFX: ${key} loaded and ready.`);
  audio.onerror = (e) => console.error(`Audio SFX: ${key} failed to load.`, e);
});

document.addEventListener('DOMContentLoaded', async () => {
  bindVotingEvents();
  await refreshDashboard('Carregando dados...');
});

function getButtonLabel(button) {
  return button?.querySelector('.btn-label');
}

function setButtonBusy(button, isBusy, busyLabel) {
  if (!button) return;

  const label = getButtonLabel(button);
  if (!button.dataset.defaultLabel && label) {
    button.dataset.defaultLabel = label.textContent;
  }

  button.disabled = isBusy;

  if (label) {
    label.textContent = isBusy ? busyLabel : button.dataset.defaultLabel || label.textContent;
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const OBJECTIVE_VAR_PLACEHOLDER = 'O VAR passou aqui';
const SCORE_EDIT_CATEGORIES = CATEGORY_DEFINITIONS.filter((category) => category.key !== 'bestWeek');

function getParticipantById(participantId) {
  return getParticipantsData().find((participant) => participant.id === participantId) || null;
}

function getObjectiveModerationState(participant, categoryKey) {
  return participant?.objectiveModeration?.[categoryKey] || { reporterIds: [], flagged: false };
}

function isObjectiveVarFlagged(participant, categoryKey) {
  const moderation = getObjectiveModerationState(participant, categoryKey);
  return Boolean(moderation.flagged) || (moderation.reporterIds?.length || 0) >= VAR_REPORT_THRESHOLD;
}

function getObjectiveDisplayState(participant, categoryKey) {
  const rawObjective = participant?.objectives?.[categoryKey];
  const hasGoal = Boolean(rawObjective && String(rawObjective).trim() !== '');
  const flagged = hasGoal && isObjectiveVarFlagged(participant, categoryKey);

  if (!hasGoal) {
    return {
      hasGoal: false,
      flagged: false,
      text: 'Nenhuma meta registrada',
    };
  }

  return {
    hasGoal: true,
    flagged,
    text: flagged ? OBJECTIVE_VAR_PLACEHOLDER : rawObjective,
  };
}

function parseScoreNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function calculateParticipantScoreTotal(categories = {}) {
  return CATEGORY_DEFINITIONS.reduce(
    (total, category) => total + parseScoreNumber(categories[category.key]),
    0,
  );
}

const PROFILE_PHOTO_MAX_SIZE = 640;
const PROFILE_PHOTO_QUALITY = 0.82;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
    image.src = dataUrl;
  });
}

async function resizeProfilePhotoFile(file) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido.');
  }

  const source = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(source);
  const ratio = Math.min(PROFILE_PHOTO_MAX_SIZE / image.width, PROFILE_PHOTO_MAX_SIZE / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', PROFILE_PHOTO_QUALITY);
}

async function getPhotoValueFromUpload({ input, currentPhotoUrl = '', removeCheckbox = null } = {}) {
  if (removeCheckbox?.checked) return '';

  const file = input?.files?.[0];
  if (!file) return currentPhotoUrl;

  return resizeProfilePhotoFile(file);
}

function getParticipantPhotoUrl(participant) {
  return participant?.photoUrl || participant?.avatarUrl || '';
}

function buildAvatarMarkup(participant, className, fallbackText = getInitials(participant?.name)) {
  const photoUrl = getParticipantPhotoUrl(participant);
  const classes = [className, photoUrl ? 'avatar-has-image' : ''].filter(Boolean).join(' ');

  if (photoUrl) {
    return `
      <div class="${classes}">
        <img
          class="avatar-image"
          src="${escapeHtml(photoUrl)}"
          alt="Foto de ${escapeHtml(participant?.name || 'participante')}"
          loading="lazy"
          referrerpolicy="no-referrer"
        />
      </div>
    `;
  }

  return `<div class="${classes}">${escapeHtml(fallbackText || '?')}</div>`;
}

function setAvatarContent(element, participant, fallbackText = getInitials(participant?.name)) {
  if (!element) return;

  const photoUrl = getParticipantPhotoUrl(participant);
  element.classList.toggle('avatar-has-image', Boolean(photoUrl));

  if (photoUrl) {
    element.innerHTML = `
      <img
        class="avatar-image"
        src="${escapeHtml(photoUrl)}"
        alt="Foto de ${escapeHtml(participant?.name || 'participante')}"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    `;
    return;
  }

  element.innerHTML = '';
  element.textContent = fallbackText || '?';
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildParticipantsById() {
  return new Map(getParticipantsData().map((participant) => [participant.id, participant]));
}

function snapshotGameState() {
  return {
    currentCategoryIndex,
    currentParticipantIndex,
    currentQueueIds: currentQueue.map((participant) => participant.id),
    currentVoterIndex,
    sessionResults: cloneState(sessionResults),
    botwVotes: cloneState(botwVotes),
    botwStep,
    bestWinnerId,
    worstWinnerId,
    pendingWeeklyFactEntry: cloneState(pendingWeeklyFactEntry),
  };
}

function restoreGameState(snapshot) {
  const participantsById = buildParticipantsById();

  currentCategoryIndex = snapshot.currentCategoryIndex;
  currentParticipantIndex = snapshot.currentParticipantIndex;
  currentQueue = snapshot.currentQueueIds
    .map((participantId) => participantsById.get(participantId))
    .filter(Boolean);
  currentVoterIndex = snapshot.currentVoterIndex;
  sessionResults = cloneState(snapshot.sessionResults);
  botwVotes = cloneState(snapshot.botwVotes);
  botwStep = snapshot.botwStep;
  bestWinnerId = snapshot.bestWinnerId;
  worstWinnerId = snapshot.worstWinnerId;
  pendingWeeklyFactEntry = cloneState(snapshot.pendingWeeklyFactEntry || null);
}

function pushGameStateSnapshot() {
  navigationHistory.push(snapshotGameState());
}

function setNavigationActions({ showBack = true, showSkip = true, skipLabel = 'Pular participante ausente' } = {}) {
  const nav = $('#modal-actions-nav');
  const backButton = $('#btn-back-step');
  const skipButton = $('#btn-skip-step');

  if (!nav || !backButton || !skipButton) return;

  const shouldShowBack = showBack && navigationHistory.length > 0;
  nav.style.display = shouldShowBack || showSkip ? 'flex' : 'none';
  backButton.style.display = shouldShowBack ? 'flex' : 'none';
  skipButton.style.display = showSkip ? 'flex' : 'none';
  skipButton.textContent = skipLabel;
}

function formatDateForDisplay(dateValue) {
  if (!dateValue) return '--';
  const [year, month, day] = String(dateValue).split('-');
  if (!year || !month || !day) return dateValue;
  return `${day}/${month}/${year}`;
}

function formatDateForInput(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPdfReportLabel() {
  const history = getWeeklyFactHistory();
  const latestHistoryEntry = history.length ? history[history.length - 1] : null;

  if (latestHistoryEntry?.date) {
    return `Rodada atual • Último registro ${formatDateForDisplay(latestHistoryEntry.date)}`;
  }

  return 'Rodada atual • Best of The Week';
}

function hasMeaningfulWeeklyFactDescription(value) {
  const normalized = String(value || '').trim();
  return normalized !== '' && normalized !== '.';
}

function buildHistoryFactMarkup(entrySide) {
  const participantsById = buildParticipantsById();
  const participant = entrySide?.participantId ? participantsById.get(entrySide.participantId) : null;
  const displayName = entrySide?.label || participant?.name || 'Sem registro';
  const description = entrySide?.description || 'Sem descrição registrada.';

  return `
    <div class="history-fact-entry">
      ${participant ? buildAvatarMarkup(participant, 'item-avatar') : '<div class="item-avatar">?</div>'}
      <div class="history-fact-copy">
        <div class="history-fact-name">${escapeHtml(displayName)}</div>
        <div class="history-fact-description">${escapeHtml(description)}</div>
      </div>
    </div>
  `;
}

function buildWinnerSummaryMarkup(participant) {
  if (!participant) return '<div class="weekly-history-summary-name">Participante não encontrado</div>';

  return `
    <div class="weekly-history-summary">
      ${buildAvatarMarkup(participant, 'item-avatar')}
      <div>
        <div class="weekly-history-summary-name">${escapeHtml(participant.name)}</div>
        <div class="weekly-history-summary-handle">${escapeHtml(participant.handle || '')}</div>
      </div>
    </div>
  `;
}

function renderWeeklyFactHistory(entries = getWeeklyFactHistory()) {
  const tbody = $('#weekly-facts-tbody');
  if (!tbody) return;

  if (!entries.length) {
    tbody.innerHTML = `
      <tr class="history-empty-row">
        <td colspan="3">Nenhum fato semanal registrado ainda.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = entries
    .map((entry) => `
      <tr>
        <td class="history-date-cell">${formatDateForDisplay(entry.date)}</td>
        <td class="history-fact-cell">${buildHistoryFactMarkup(entry.best)}</td>
        <td class="history-fact-cell">${buildHistoryFactMarkup(entry.worst)}</td>
      </tr>
    `)
    .join('');
}

function renderCurrentGameState() {
  if (currentCategoryIndex >= CATEGORIES_ORDER.length) {
    showFinishScreen();
    return;
  }

  if (botwStep === 'BEST_WINNER') {
    renderBOTWSelection('BEST', false);
    return;
  }

  if (botwStep === 'WORST_WINNER') {
    renderBOTWSelection('WORST', false);
    return;
  }

  if (botwStep === 'DESCRIPTION_CAPTURE') {
    showWeeklyFactCaptureStep();
    return;
  }

  renderVotingStep();
}

function renderDashboard() {
  const rankings = getCategorizedRankings();

  renderCategory('cat-exercicio', rankings.exercicio);
  renderCategory('cat-familia', rankings.familia);
  renderCategory('cat-alimentacao', rankings.alimentacao);
  renderCategory('cat-hobbies', rankings.hobbies);
  renderCategory('cat-conhecimentos', rankings.conhecimentos);
  renderCategory('cat-bestWeek', rankings.bestWeek);
  renderGeneralRanking(rankings.geral);
  renderWeeklyFactHistory();
}

async function refreshDashboard(loadingLabel = 'Carregando...') {
  const startButton = $('#start-voting-btn');
  const resetButton = $('#reset-scores-btn');

  setButtonBusy(startButton, true, loadingLabel);
  setButtonBusy(resetButton, true, loadingLabel);

  await loadParticipantsData();
  renderDashboard();

  setButtonBusy(startButton, false, loadingLabel);
  setButtonBusy(resetButton, false, loadingLabel);
}

function renderCategory(containerId, sortedData) {
  const container = $(`#${containerId} .category-podium`);
  if (!container) return;

  const top5 = sortedData.slice(0, 5);

  container.innerHTML = top5
    .map((person, index) => {
      const rank = index + 1;
      const categoryKey = containerId.replace('cat-', '');
      const points = person.categories[categoryKey];

      return `
        <div class="podium-item">
          <div class="item-rank ${rank <= 3 ? `rank-${rank}` : ''}">${rank}º</div>
          <div class="podium-clickable" onclick="window.showParticipantGoals('${escapeHtml(person.id)}')">
            ${buildAvatarMarkup(person, 'item-avatar')}
            <div class="item-info">
              <div class="item-name">${person.name}</div>
              <div class="item-handle">${person.handle}</div>
            </div>
          </div>
          <div class="item-score">${points} pts</div>
        </div>
      `;
    })
    .join('');
}

function renderGeneralRanking(generalData) {
  const tbody = $('#ranking-geral-tbody');
  if (!tbody) return;

  tbody.innerHTML = generalData
    .map((participant, index) => {
      const rank = index + 1;

      return `
        <tr>
          <td>
            <span class="rank-badge ${rank <= 3 ? `rank-${rank}` : ''}">${rank}</span>
          </td>
          <td>
            <div class="creator-cell creator-cell-clickable" onclick="window.showParticipantGoals('${escapeHtml(participant.id)}')">
              ${buildAvatarMarkup(participant, 'creator-avatar')}
              <div>
                <div class="creator-name">${participant.name}</div>
                <div class="creator-handle">${participant.handle}</div>
              </div>
            </div>
          </td>
          <td class="td-metric hide-mobile">${participant.categories.exercicio}</td>
          <td class="td-metric hide-mobile">${participant.categories.familia}</td>
          <td class="td-metric hide-mobile">${participant.categories.alimentacao}</td>
          <td class="td-metric hide-mobile">${participant.categories.hobbies}</td>
          <td class="td-metric hide-mobile">${participant.categories.conhecimentos}</td>
          <td class="td-metric hide-mobile">${participant.categories.bestWeek}</td>
          <td class="td-total">${participant.totalPoints}</td>
        </tr>
      `;
    })
    .join('');
}

function bindVotingEvents() {
  $('#start-voting-btn')?.addEventListener('click', startVotingSystem);
  $('#reset-scores-btn')?.addEventListener('click', handleResetScores);
  $('#manage-btn')?.addEventListener('click', openManagementHome);
  $('#download-pdf-btn')?.addEventListener('click', () => {
    const rankings = getCategorizedRankings();
    generatePDF(rankings, getPdfReportLabel());
  });
  $('#modal-close-btn')?.addEventListener('click', () => {
    $('#voting-modal').style.display = 'none';
  });

  $('#btn-vote-yes')?.addEventListener('click', () => handleVote(1));
  $('#btn-vote-neutral')?.addEventListener('click', () => handleVote(0));
  $('#btn-next-speaker')?.addEventListener('click', handleAdvanceSpeaker);
  $('#btn-finish-voting')?.addEventListener('click', finishVotingSystem);
  $('#btn-save-history')?.addEventListener('click', handleSaveWeeklyFactHistory);
  $('#btn-back-step')?.addEventListener('click', handleBackStep);
  $('#btn-skip-step')?.addEventListener('click', handleSkipStep);

  // Management Events
  $('#management-content')?.addEventListener('click', handleManagementContentClick);
  $('#management-content')?.addEventListener('change', handleManagementContentChange);
  $('#management-content')?.addEventListener('input', handleManagementContentInput);
  $('#management-close-btn')?.addEventListener('click', () => {
    $('#management-modal').style.display = 'none';
  });
  $('#management-btn-back')?.addEventListener('click', handleMgmtBack);
  $('#management-btn-next')?.addEventListener('click', handleMgmtNext);

  // Goals Modal Events
  $('#goals-close-btn')?.addEventListener('click', () => {
    $('#goals-modal').style.display = 'none';
  });
  $('#goals-btn-back')?.addEventListener('click', handleGoalsBack);
  $('#goals-btn-next')?.addEventListener('click', handleGoalsNext);

  // Initialize goals countdown timer
  startGoalsCountdown();
}

// Management Flow State
let mgmtFlow = null; // 'HOME' | 'ADD_PARTICIPANT' | 'MANAGE_PARTICIPANTS' | 'ADD_WEEKLY_FACT' | 'CALL_VAR' | 'NEW_CYCLE'
let mgmtStep = 0;
let mgmtData = {};
const MGMT_CATEGORIES = CATEGORY_DEFINITIONS.filter(c => c.key !== 'bestWeek');

function buildParticipantOptionsMarkup(selectedId = '') {
  const options = [...getParticipantsData()]
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    .map((participant) => `
      <option value="${escapeHtml(participant.id)}" ${participant.id === selectedId ? 'selected' : ''}>
        ${escapeHtml(participant.name)}
      </option>
    `);

  return [
    '<option value="">Selecione um participante</option>',
    ...options,
  ].join('');
}

function setManagementModalVariant(variant = 'default') {
  const modal = $('#management-modal');
  if (!modal) return;

  modal.classList.toggle('management-modal--hub', variant === 'hub');
  modal.classList.toggle('management-modal--weekly-fact', variant === 'weekly-fact');
}

function openManagementHome() {
  mgmtFlow = 'HOME';
  mgmtStep = 0;
  mgmtData = {};

  $('#management-modal').style.display = 'flex';
  $('#management-title').textContent = 'Gerenciar';
  $('#management-icon').textContent = '⚙️';
  renderManagementStep();
}

function handleManagementContentClick(event) {
  const actionTrigger = event.target.closest('[data-mgmt-action]');
  if (!actionTrigger) return;

  const { mgmtAction } = actionTrigger.dataset;
  const participantId = actionTrigger.dataset.participantId;

  if (mgmtAction === 'ADD_PARTICIPANT') {
    startAddParticipantFlow();
  } else if (mgmtAction === 'MANAGE_PARTICIPANTS') {
    startManageParticipantsFlow();
  } else if (mgmtAction === 'ADD_WEEKLY_FACT') {
    startAddWeeklyFactFlow();
  } else if (mgmtAction === 'CALL_VAR') {
    startCallVarFlow();
  } else if (mgmtAction === 'NEW_CYCLE') {
    startNewCycleFlow();
  } else if (mgmtAction === 'OPEN_GOALS' && isGoalsWindowActive()) {
    $('#management-modal').style.display = 'none';
    openGoalsModal();
  } else if (mgmtAction === 'REMOVE_PARTICIPANT' && participantId) {
    handleRemoveParticipant(participantId);
  } else if (mgmtAction === 'SAVE_PARTICIPANT_SCORES' && participantId) {
    handleSaveParticipantScores(participantId);
  }
}

function handleManagementContentChange(event) {
  if (mgmtFlow === 'MANAGE_PARTICIPANTS' && event.target.id === 'mgmt-participant-select') {
    mgmtData.selectedParticipantId = event.target.value || '';
    renderManagementStep();
    return;
  }

  if (mgmtFlow !== 'CALL_VAR') return;

  if (event.target.id === 'mgmt-var-reporter') {
    mgmtData.reporterId = event.target.value || '';
    renderManagementStep();
  }

  if (event.target.id === 'mgmt-var-participant') {
    mgmtData.participantId = event.target.value || '';
    renderManagementStep();
  }

  if (event.target.id === 'mgmt-var-category') {
    mgmtData.categoryKey = event.target.value || '';
    renderManagementStep();
  }
}

function handleManagementContentInput(event) {
  if (mgmtFlow !== 'MANAGE_PARTICIPANTS') return;

  const participantCard = event.target.closest('[data-participant-card]');
  if (!participantCard) return;

  updateParticipantScorePreview(participantCard.dataset.participantCard);
}

function startAddParticipantFlow() {
  mgmtFlow = 'ADD_PARTICIPANT';
  mgmtStep = 0;
  mgmtData = { name: '', handle: '', photoUrl: '', objectives: {} };
  
  $('#management-modal').style.display = 'flex';
  $('#management-title').textContent = 'Adicionar Participante';
  $('#management-icon').textContent = '👤';
  renderManagementStep();
}

function startManageParticipantsFlow() {
  mgmtFlow = 'MANAGE_PARTICIPANTS';
  mgmtStep = 0;
  mgmtData = { selectedParticipantId: '' };

  $('#management-modal').style.display = 'flex';
  $('#management-title').textContent = 'Gerenciar Participantes';
  $('#management-icon').textContent = '👥';
  renderManagementStep();
}

export async function handleRemoveParticipant(id) {
  const confirmMsg = 'Tem certeza que deseja excluir permanentemente este participante? As pontuações dele(a) serão apagadas.';
  if (window.confirm(confirmMsg)) {
    const name = getParticipantsData().find(p => p.id === id)?.name || id;
    removeParticipant(id);
    createSnapshot(`Participante removido: ${name}`);
    renderManagementStep();
    renderDashboard();
  }
}
// Torna global para que o onclick= inline funcione
window.handleRemoveParticipant = handleRemoveParticipant;

function updateParticipantScorePreview(participantId) {
  const card = $(`[data-participant-card="${participantId}"]`);
  if (!card) return;

  const categories = {
    exercicio: parseScoreNumber($(`#mgmt-score-${participantId}-exercicio`)?.value),
    familia: parseScoreNumber($(`#mgmt-score-${participantId}-familia`)?.value),
    alimentacao: parseScoreNumber($(`#mgmt-score-${participantId}-alimentacao`)?.value),
    hobbies: parseScoreNumber($(`#mgmt-score-${participantId}-hobbies`)?.value),
    conhecimentos: parseScoreNumber($(`#mgmt-score-${participantId}-conhecimentos`)?.value),
    bestWeek: parseScoreNumber($(`#mgmt-score-${participantId}-bestWeek`)?.value),
  };

  const baseWithoutBestWeek = SCORE_EDIT_CATEGORIES.reduce(
    (total, category) => total + parseScoreNumber(categories[category.key]),
    0,
  );

  const totalOverrideInput = $(`#mgmt-total-override-${participantId}`);
  const totalOverrideRaw = totalOverrideInput?.value?.trim() || '';
  const totalOverride = totalOverrideRaw === '' ? null : parseScoreNumber(totalOverrideRaw, null);
  const finalBestWeek = totalOverride === null ? categories.bestWeek : totalOverride - baseWithoutBestWeek;
  const finalTotal = baseWithoutBestWeek + finalBestWeek;

  const totalPreview = $(`#mgmt-total-preview-${participantId}`);
  const bestWeekHint = $(`#mgmt-bestweek-hint-${participantId}`);

  if (totalPreview) {
    totalPreview.textContent = `${finalTotal} pts`;
  }

  if (bestWeekHint) {
    bestWeekHint.textContent = totalOverride === null
      ? `Best of The Week atual: ${categories.bestWeek} pts`
      : `Com o total informado, Best of The Week ficará em ${finalBestWeek} pts`;
  }
}

async function handleSaveParticipantScores(participantId) {
  const participant = getParticipantById(participantId);
  if (!participant) {
    window.alert('Participante não encontrado para salvar as alterações.');
    return;
  }

  let photoUrl = getParticipantPhotoUrl(participant);
  try {
    photoUrl = await getPhotoValueFromUpload({
      input: $(`#mgmt-photo-${participantId}`),
      currentPhotoUrl: photoUrl,
      removeCheckbox: $(`#mgmt-remove-photo-${participantId}`),
    });
  } catch (error) {
    window.alert(error.message || 'Não foi possível processar a imagem selecionada.');
    return;
  }

  const categories = {
    exercicio: parseScoreNumber($(`#mgmt-score-${participantId}-exercicio`)?.value),
    familia: parseScoreNumber($(`#mgmt-score-${participantId}-familia`)?.value),
    alimentacao: parseScoreNumber($(`#mgmt-score-${participantId}-alimentacao`)?.value),
    hobbies: parseScoreNumber($(`#mgmt-score-${participantId}-hobbies`)?.value),
    conhecimentos: parseScoreNumber($(`#mgmt-score-${participantId}-conhecimentos`)?.value),
    bestWeek: parseScoreNumber($(`#mgmt-score-${participantId}-bestWeek`)?.value),
  };

  const totalOverrideRaw = $(`#mgmt-total-override-${participantId}`)?.value?.trim() || '';
  if (totalOverrideRaw !== '') {
    if (!Number.isFinite(Number(totalOverrideRaw))) {
      window.alert('Informe um total final válido para salvar a pontuação.');
      return;
    }

    const baseWithoutBestWeek = SCORE_EDIT_CATEGORIES.reduce(
      (total, category) => total + parseScoreNumber(categories[category.key]),
      0,
    );
    categories.bestWeek = parseScoreNumber(totalOverrideRaw) - baseWithoutBestWeek;
  }

  updateParticipantProfile(participantId, { photoUrl });
  updateParticipantScores(participantId, categories);
  createSnapshot(`Participante atualizado: ${participant.name}`);
  renderDashboard();
  renderManagementStep();
  window.alert(`Dados de ${participant.name} atualizados com sucesso.`);
}

function startAddWeeklyFactFlow() {
  mgmtFlow = 'ADD_WEEKLY_FACT';
  mgmtStep = 0;
  mgmtData = {
    date: formatDateForInput(),
    bestParticipantId: '',
    bestDescription: '',
    worstParticipantId: '',
    worstDescription: '',
  };

  $('#management-modal').style.display = 'flex';
  $('#management-title').textContent = 'Adicionar Melhor e Pior Fato';
  $('#management-icon').textContent = '📝';
  renderManagementStep();
}

function startCallVarFlow() {
  mgmtFlow = 'CALL_VAR';
  mgmtStep = 0;
  mgmtData = {
    reporterId: '',
    participantId: '',
    categoryKey: MGMT_CATEGORIES[0]?.key || '',
  };

  $('#management-modal').style.display = 'flex';
  $('#management-title').textContent = 'Chamar o VAR';
  $('#management-icon').textContent = '🚨';
  renderManagementStep();
}

async function startNewCycleFlow() {
  const confirmed = window.confirm('Isso vai zerar as pontuações atuais e permitir redefinir os objetivos de todos. Continuar?');
  if (!confirmed) return;

  await resetAllScores();
  renderDashboard();

  mgmtFlow = 'NEW_CYCLE';
  mgmtStep = 0;
  mgmtData = { participants: getParticipantsData(), currentIndex: 0, currentCatIndex: 0 };

  $('#management-modal').style.display = 'flex';
  $('#management-title').textContent = 'Novo Ciclo: Objetivos';
  $('#management-icon').textContent = '🚀';
  renderManagementStep();
}

function renderManagementStep() {
  const content = $('#management-content');
  const btnNext = $('#management-btn-next');
  const btnBack = $('#management-btn-back');

  const variant = mgmtFlow === 'HOME'
    ? 'hub'
    : mgmtFlow === 'CALL_VAR'
      ? 'hub'
    : mgmtFlow === 'ADD_WEEKLY_FACT'
      ? 'weekly-fact'
      : 'default';

  setManagementModalVariant(variant);
  btnBack.style.display = mgmtFlow === 'HOME' ? 'none' : 'flex';
  btnNext.style.display = mgmtFlow === 'HOME' || mgmtFlow === 'MANAGE_PARTICIPANTS' ? 'none' : 'flex';
  btnNext.textContent = 'Próximo';

  if (mgmtFlow === 'HOME') {
    content.innerHTML = `
      <div class="management-home">
        <section class="management-home-banner">
          <span class="management-home-eyebrow">Central de ações</span>
          <h4 class="management-home-title">Organize a rodada em um só lugar</h4>
          <p class="management-home-copy">
            Cadastre participantes, acompanhe o status das metas e atualize o histórico da semana sem navegar por menus soltos.
          </p>
        </section>

        <section class="management-home-grid">
          <button type="button" class="management-action-card" data-mgmt-action="ADD_PARTICIPANT">
            <div class="management-action-header">
              <span class="management-action-icon">➕</span>
            </div>
            <span class="management-action-text">
              <strong class="management-action-title">Adicionar participante</strong>
              <span class="management-action-description">Cadastre um novo nome e já configure as metas iniciais da semana.</span>
            </span>
            <span class="management-card-cta">Cadastrar</span>
          </button>

          <button type="button" class="management-action-card management-action-card--goals" data-mgmt-action="OPEN_GOALS" id="mgmt-goals-panel">
            <div class="management-action-header">
              <span class="management-action-icon">🎯</span>
              <span class="management-card-chip management-card-chip--success" id="mgmt-goals-chip">Sempre aberto</span>
            </div>
            <span class="management-action-text">
              <strong class="management-action-title">Registro de metas</strong>
              <span class="management-action-description" id="mgmt-goals-status">O registro de metas fica liberado o tempo todo.</span>
              <span class="management-action-subcopy" id="mgmt-goals-meta">Os participantes podem criar ou editar as metas sempre que precisarem.</span>
            </span>
            <span class="management-card-cta" id="mgmt-goals-btn">Registrar metas</span>
            <div class="management-goals-countdown" id="mgmt-goals-countdown" hidden></div>
          </button>

          <button type="button" class="management-action-card management-action-card--var" data-mgmt-action="CALL_VAR">
            <div class="management-action-header">
              <span class="management-action-icon">🚨</span>
              <span class="management-card-chip management-card-chip--alert">3 denúncias</span>
            </div>
            <span class="management-action-text">
              <strong class="management-action-title">Chamar o VAR</strong>
              <span class="management-action-description">Se três pessoas denunciarem a mesma meta, ela some e vira "O VAR passou aqui" até ser alterada.</span>
            </span>
            <span class="management-card-cta">Abrir VAR</span>
          </button>

          <button type="button" class="management-action-card" data-mgmt-action="MANAGE_PARTICIPANTS">
            <div class="management-action-header">
              <span class="management-action-icon">👥</span>
            </div>
            <span class="management-action-text">
              <strong class="management-action-title">Gerenciar participantes</strong>
              <span class="management-action-description">Selecione um participante para ajustar pontos por categoria, total final ou excluir o perfil.</span>
            </span>
            <span class="management-card-cta">Abrir editor</span>
          </button>

          <button type="button" class="management-action-card" data-mgmt-action="ADD_WEEKLY_FACT">
            <div class="management-action-header">
              <span class="management-action-icon">📝</span>
            </div>
            <span class="management-action-text">
              <strong class="management-action-title">Melhor e pior fato</strong>
              <span class="management-action-description">Atualize o histórico da home com os acontecimentos da semana.</span>
            </span>
            <span class="management-card-cta">Atualizar histórico</span>
          </button>

          <button type="button" class="management-action-card management-action-card--alert" data-mgmt-action="NEW_CYCLE">
            <div class="management-action-header">
              <span class="management-action-icon">🚀</span>
            </div>
            <span class="management-action-text">
              <strong class="management-action-title">Iniciar novo melhores</strong>
              <span class="management-action-description">Zere a rodada atual e redefina as metas para começar um novo ciclo.</span>
            </span>
            <span class="management-card-cta">Reiniciar rodada</span>
          </button>
        </section>
      </div>
    `;

    syncGoalsButtonState();
    return;
  }

  if (mgmtFlow === 'CALL_VAR') {
    const participants = [...getParticipantsData()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const selectedParticipant = getParticipantById(mgmtData.participantId);
    const selectedCategory = MGMT_CATEGORIES.find((category) => category.key === mgmtData.categoryKey) || MGMT_CATEGORIES[0];
    const objectiveState = selectedParticipant && selectedCategory
      ? getObjectiveDisplayState(selectedParticipant, selectedCategory.key)
      : null;
    const reviewState = selectedParticipant && selectedCategory
      ? getObjectiveModerationState(selectedParticipant, selectedCategory.key)
      : { reporterIds: [], flagged: false };
    const reporterNames = reviewState.reporterIds
      .map((reporterId) => getParticipantById(reporterId)?.name || reporterId)
      .filter(Boolean);
    const categoryOptions = MGMT_CATEGORIES
      .map((category) => `
        <option value="${escapeHtml(category.key)}" ${category.key === selectedCategory?.key ? 'selected' : ''}>
          ${escapeHtml(category.title)}
        </option>
      `)
      .join('');

    btnNext.textContent = 'Registrar denúncia';

    content.innerHTML = `
      <div class="mgmt-var-shell">
        <section class="mgmt-var-intro">
          <span class="mgmt-weekly-eyebrow">Validação de metas</span>
          <h4 class="mgmt-weekly-title">Chamar o VAR</h4>
          <p class="mgmt-weekly-copy">
            Registre uma denúncia quando uma meta estiver fora do combinado. Com ${VAR_REPORT_THRESHOLD} denúncias únicas, a meta some do jogo e fica marcada como "${OBJECTIVE_VAR_PLACEHOLDER}" até ser alterada.
          </p>
        </section>

        <div class="mgmt-var-grid">
          <section class="mgmt-var-panel">
            <div class="mgmt-form-group">
              <label for="mgmt-var-reporter">Quem está denunciando?</label>
              <select id="mgmt-var-reporter" class="mgmt-input">
                <option value="">Selecione um participante</option>
                ${participants.map((participant) => `
                  <option value="${escapeHtml(participant.id)}" ${participant.id === mgmtData.reporterId ? 'selected' : ''}>
                    ${escapeHtml(participant.name)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="mgmt-form-group">
              <label for="mgmt-var-participant">Meta de quem vai para revisão?</label>
              <select id="mgmt-var-participant" class="mgmt-input">
                <option value="">Selecione um participante</option>
                ${participants.map((participant) => `
                  <option value="${escapeHtml(participant.id)}" ${participant.id === mgmtData.participantId ? 'selected' : ''}>
                    ${escapeHtml(participant.name)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="mgmt-form-group mgmt-form-group-last">
              <label for="mgmt-var-category">Categoria da meta</label>
              <select id="mgmt-var-category" class="mgmt-input">
                ${categoryOptions}
              </select>
            </div>
          </section>

          <section class="mgmt-var-panel mgmt-var-panel--preview">
            <div class="mgmt-var-preview-head">
              <div>
                <span class="weekly-history-badge badge-worst">Radar do VAR</span>
                <h5 class="mgmt-weekly-card-title">Status da meta</h5>
              </div>
              <span class="management-card-chip ${reviewState.flagged ? 'management-card-chip--alert' : 'management-card-chip--neutral'}">
                ${reviewState.reporterIds.length}/${VAR_REPORT_THRESHOLD} denúncias
              </span>
            </div>

            ${selectedParticipant && selectedCategory ? `
              <div class="mgmt-var-summary">
                ${buildAvatarMarkup(selectedParticipant, 'item-avatar')}
                <div>
                  <div class="weekly-history-summary-name">${escapeHtml(selectedParticipant.name)}</div>
                  <div class="weekly-history-summary-handle">${escapeHtml(selectedCategory.title)}</div>
                </div>
              </div>
              <div class="mgmt-var-goal ${objectiveState?.flagged ? 'is-flagged' : ''}">
                ${objectiveState?.hasGoal ? escapeHtml(objectiveState.text) : 'Nenhuma meta cadastrada nessa categoria.'}
              </div>
            ` : `
              <div class="mgmt-var-empty">Selecione um participante e uma categoria para revisar a meta atual.</div>
            `}

            <div class="mgmt-var-reporters">
              <span class="mgmt-var-reporters-label">Denúncias registradas</span>
              ${reporterNames.length
                ? `<div class="mgmt-var-reporters-list">${reporterNames.map((name) => `<span class="mgmt-var-reporter-chip">${escapeHtml(name)}</span>`).join('')}</div>`
                : '<p class="mgmt-var-reporters-empty">Ainda não há denúncias nessa meta.</p>'}
            </div>

            ${reviewState.flagged ? `
              <p class="mgmt-var-warning">O VAR passou aqui. A meta ficará oculta no jogo e no perfil até o participante alterar esse texto.</p>
            ` : `
              <p class="mgmt-var-warning">Quando a terceira denúncia única entrar, a meta será ocultada automaticamente.</p>
            `}
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (mgmtFlow === 'MANAGE_PARTICIPANTS') {
    const participants = getParticipantsData().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    
    if (participants.length === 0) {
      content.innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.7;">Nenhum participante cadastrado.</p>';
      return;
    }

    const selectedParticipantId = participants.some((participant) => participant.id === mgmtData.selectedParticipantId)
      ? mgmtData.selectedParticipantId
      : '';
    mgmtData.selectedParticipantId = selectedParticipantId;
    const selectedParticipant = selectedParticipantId
      ? participants.find((participant) => participant.id === selectedParticipantId)
      : null;

    content.innerHTML = `
      <div class="mgmt-participants-shell">
        <section class="mgmt-participants-intro">
          <span class="mgmt-weekly-eyebrow">Editor de pontuação</span>
          <h4 class="mgmt-weekly-title">Gerenciar participantes</h4>
          <p class="mgmt-weekly-copy">
            Escolha primeiro quem você quer editar. Depois, ajuste foto, pontuações por categoria, confira o total final e exclua o participante se precisar.
          </p>
        </section>

        <section class="mgmt-participants-picker">
          <label for="mgmt-participant-select" class="mgmt-score-label">Selecione um participante</label>
          <select id="mgmt-participant-select" class="mgmt-input">
            <option value="">Escolha quem você quer gerenciar</option>
            ${participants.map((participant) => `
              <option value="${escapeHtml(participant.id)}" ${participant.id === selectedParticipantId ? 'selected' : ''}>
                ${escapeHtml(participant.name)}
              </option>
            `).join('')}
          </select>
          <p class="mgmt-participants-picker-copy">
            Ao selecionar alguém, o editor aparece logo abaixo com foto, categorias e total final.
          </p>
        </section>

        ${selectedParticipant ? `
          <article class="mgmt-participant-card mgmt-participant-card--editor" data-participant-card="${escapeHtml(selectedParticipant.id)}">
            <div class="mgmt-participant-card-head">
              <div class="mgmt-participant-summary">
              ${buildAvatarMarkup(selectedParticipant, 'item-avatar', getInitials(selectedParticipant.name))}
                <div class="mgmt-participant-meta">
                  <span class="mgmt-participant-name">${escapeHtml(selectedParticipant.name)}</span>
                  <span class="mgmt-participant-handle">${escapeHtml(selectedParticipant.handle)}</span>
                </div>
              </div>
              <div class="mgmt-participant-total-box">
                <span class="mgmt-participant-total-label">Total atual</span>
                <strong class="mgmt-participant-total-value" id="mgmt-total-preview-${escapeHtml(selectedParticipant.id)}">${selectedParticipant.totalPoints} pts</strong>
              </div>
            </div>

            <label class="mgmt-profile-photo-field">
              <span class="mgmt-score-label">Foto de perfil</span>
              <input
                type="file"
                accept="image/*"
                class="mgmt-file-input"
                id="mgmt-photo-${escapeHtml(selectedParticipant.id)}"
              >
              <span class="mgmt-score-hint">A imagem será ajustada automaticamente antes de salvar.</span>
              ${getParticipantPhotoUrl(selectedParticipant) ? `
                <label class="mgmt-inline-check">
                  <input type="checkbox" id="mgmt-remove-photo-${escapeHtml(selectedParticipant.id)}">
                  <span>Remover foto atual</span>
                </label>
              ` : ''}
            </label>

            <div class="mgmt-score-grid">
              ${SCORE_EDIT_CATEGORIES.map((category) => `
                <label class="mgmt-score-field">
                  <span class="mgmt-score-label">${category.icon} ${escapeHtml(category.title)}</span>
                  <input
                    type="number"
                    class="mgmt-input"
                    id="mgmt-score-${escapeHtml(selectedParticipant.id)}-${category.key}"
                    value="${parseScoreNumber(selectedParticipant.categories?.[category.key])}"
                    step="1"
                  >
                </label>
              `).join('')}

              <label class="mgmt-score-field">
                <span class="mgmt-score-label">🌟 Best of The Week</span>
                <input
                  type="number"
                  class="mgmt-input"
                  id="mgmt-score-${escapeHtml(selectedParticipant.id)}-bestWeek"
                  value="${parseScoreNumber(selectedParticipant.categories?.bestWeek)}"
                  step="1"
                >
              </label>

              <label class="mgmt-score-field mgmt-score-field--total">
                <span class="mgmt-score-label">Σ Ajustar total final</span>
                <input
                  type="number"
                  class="mgmt-input"
                  id="mgmt-total-override-${escapeHtml(selectedParticipant.id)}"
                  value=""
                  step="1"
                  placeholder="${selectedParticipant.totalPoints}"
                >
                <span class="mgmt-score-hint" id="mgmt-bestweek-hint-${escapeHtml(selectedParticipant.id)}">Best of The Week atual: ${parseScoreNumber(selectedParticipant.categories?.bestWeek)} pts</span>
              </label>
            </div>

            <div class="mgmt-participant-actions">
              <button
                type="button"
                class="btn btn-primary"
                data-mgmt-action="SAVE_PARTICIPANT_SCORES"
                data-participant-id="${escapeHtml(selectedParticipant.id)}"
              >
                Salvar alterações
              </button>
              <button
                type="button"
                class="btn btn-danger-ghost"
                data-mgmt-action="REMOVE_PARTICIPANT"
                data-participant-id="${escapeHtml(selectedParticipant.id)}"
              >
                Excluir participante
              </button>
            </div>
          </article>
        ` : `
          <div class="mgmt-participant-empty">
            Selecione um participante acima para abrir o editor de pontuação e gerenciamento.
          </div>
        `}
      </div>
    `;
    return;
  }

  if (mgmtFlow === 'ADD_WEEKLY_FACT') {
    btnNext.textContent = 'Salvar fatos';
    content.innerHTML = `
      <div class="mgmt-weekly-shell">
        <section class="mgmt-weekly-intro">
          <span class="mgmt-weekly-eyebrow">Histórico manual</span>
          <h4 class="mgmt-weekly-title">Registrar melhor e pior fato da semana</h4>
          <p class="mgmt-weekly-copy">
            Escolha os responsáveis e descreva os fatos para manter o histórico da home sempre atualizado.
          </p>
        </section>

        <div class="mgmt-weekly-grid">
          <aside class="mgmt-weekly-date-card">
            <span class="mgmt-weekly-date-label">Semana de referência</span>
            <div class="mgmt-form-group">
              <label for="mgmt-weekly-date">Data</label>
              <input type="date" id="mgmt-weekly-date" class="mgmt-input" value="${escapeHtml(mgmtData.date || formatDateForInput())}">
            </div>
          </aside>

          <section class="weekly-history-card mgmt-weekly-card">
            <div class="weekly-history-card-header mgmt-weekly-card-header">
              <div>
                <span class="weekly-history-badge badge-best">Melhor fato</span>
                <h5 class="mgmt-weekly-card-title">Quem viveu o melhor momento?</h5>
              </div>
              <p class="mgmt-weekly-card-copy">Selecione o responsável e registre o que aconteceu.</p>
            </div>
            <div class="mgmt-form-group">
              <label for="mgmt-best-participant">Responsável</label>
              <select id="mgmt-best-participant" class="mgmt-input">
                ${buildParticipantOptionsMarkup(mgmtData.bestParticipantId)}
              </select>
            </div>
            <div class="mgmt-form-group mgmt-form-group-last">
              <label for="mgmt-best-description">Descrição do fato</label>
              <textarea id="mgmt-best-description" class="mgmt-input mgmt-area mgmt-area-compact" placeholder="Ex: Participou de show">${escapeHtml(mgmtData.bestDescription || '')}</textarea>
            </div>
          </section>

          <section class="weekly-history-card mgmt-weekly-card">
            <div class="weekly-history-card-header mgmt-weekly-card-header">
              <div>
                <span class="weekly-history-badge badge-worst">Pior fato</span>
                <h5 class="mgmt-weekly-card-title">Quem passou pelo pior momento?</h5>
              </div>
              <p class="mgmt-weekly-card-copy">Selecione o responsável e descreva o fato com clareza.</p>
            </div>
            <div class="mgmt-form-group">
              <label for="mgmt-worst-participant">Responsável</label>
              <select id="mgmt-worst-participant" class="mgmt-input">
                ${buildParticipantOptionsMarkup(mgmtData.worstParticipantId)}
              </select>
            </div>
            <div class="mgmt-form-group mgmt-form-group-last">
              <label for="mgmt-worst-description">Descrição do fato</label>
              <textarea id="mgmt-worst-description" class="mgmt-input mgmt-area mgmt-area-compact" placeholder="Ex: Torceu o pé no futebol">${escapeHtml(mgmtData.worstDescription || '')}</textarea>
            </div>
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (mgmtFlow === 'ADD_PARTICIPANT') {
    if (mgmtStep === 0) {
      content.innerHTML = `
        <div class="mgmt-form-group">
          <label>Nome Completo</label>
          <input type="text" id="mgmt-name" class="mgmt-input" placeholder="Ex: João Silva" value="${mgmtData.name}">
        </div>
        <div class="mgmt-form-group">
          <label>Handle (@usuario)</label>
          <input type="text" id="mgmt-handle" class="mgmt-input" placeholder="Ex: @joao" value="${mgmtData.handle}">
        </div>
        <div class="mgmt-form-group">
          <label>Foto de perfil</label>
          <input type="file" id="mgmt-photoFile" class="mgmt-file-input" accept="image/*">
          <span class="mgmt-score-hint">Opcional. A imagem será ajustada automaticamente antes de salvar.</span>
        </div>
      `;
    } else if (mgmtStep <= MGMT_CATEGORIES.length) {
      const cat = MGMT_CATEGORIES[mgmtStep - 1];
      content.innerHTML = `
        <div class="wizard-step-info">
          <div class="wizard-step-icon">${cat.icon}</div>
          <div class="wizard-step-title">${cat.title}</div>
          <p style="font-size: 0.85rem; opacity: 0.7; margin-top: 4px;">Defina a meta da semana para esta categoria</p>
        </div>
        <div class="mgmt-form-group">
          <textarea id="mgmt-objective" class="mgmt-input mgmt-area" placeholder="Ex: Treinar 3x na semana">${mgmtData.objectives[cat.key] || ''}</textarea>
        </div>
      `;
      if (mgmtStep === MGMT_CATEGORIES.length) btnNext.textContent = 'Finalizar';
    }
  } else if (mgmtFlow === 'NEW_CYCLE') {
    const participant = mgmtData.participants[mgmtData.currentIndex];
    const cat = MGMT_CATEGORIES[mgmtData.currentCatIndex];

    content.innerHTML = `
      <div class="wizard-step-info">
        ${buildAvatarMarkup(participant, 'modal-avatar modal-avatar-compact')}
        <div class="item-name" style="font-size: 1.1rem; margin-bottom: 16px;">${participant.name}</div>
        <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-bottom: 16px;">
        <div class="wizard-step-icon">${cat.icon}</div>
        <div class="wizard-step-title">${cat.title}</div>
      </div>
      <div class="mgmt-form-group">
        <textarea id="mgmt-objective" class="mgmt-input mgmt-area" placeholder="Nova meta para ${cat.title}">${participant.objectives[cat.key] || ''}</textarea>
      </div>
    `;

    const isLast = mgmtData.currentIndex === mgmtData.participants.length - 1 && mgmtData.currentCatIndex === MGMT_CATEGORIES.length - 1;
    if (isLast) btnNext.textContent = 'Finalizar';
  }
}

function handleMgmtBack() {
  if (mgmtFlow === 'ADD_PARTICIPANT') {
    if (mgmtStep > 0) {
      mgmtStep--;
      renderManagementStep();
      return;
    }

    openManagementHome();
  } else if (mgmtFlow === 'NEW_CYCLE') {
    if (mgmtStep <= 0) {
      openManagementHome();
      return;
    }

    if (mgmtData.currentCatIndex > 0) {
      mgmtData.currentCatIndex--;
    } else if (mgmtData.currentIndex > 0) {
      mgmtData.currentIndex--;
      mgmtData.currentCatIndex = MGMT_CATEGORIES.length - 1;
    }
    mgmtStep--;
    renderManagementStep();
  } else if (mgmtFlow === 'MANAGE_PARTICIPANTS' || mgmtFlow === 'ADD_WEEKLY_FACT' || mgmtFlow === 'CALL_VAR') {
    openManagementHome();
  }
}

async function handleMgmtNext() {
  if (mgmtFlow === 'CALL_VAR') {
    mgmtData.reporterId = $('#mgmt-var-reporter')?.value || '';
    mgmtData.participantId = $('#mgmt-var-participant')?.value || '';
    mgmtData.categoryKey = $('#mgmt-var-category')?.value || '';

    if (!mgmtData.reporterId || !mgmtData.participantId || !mgmtData.categoryKey) {
      window.alert('Selecione quem denuncia, qual participante será revisado e a categoria da meta.');
      return;
    }

    const reportResult = reportParticipantObjective({
      reporterId: mgmtData.reporterId,
      participantId: mgmtData.participantId,
      categoryKey: mgmtData.categoryKey,
    });

    if (!reportResult.ok) {
      const messages = {
        INVALID_INPUT: 'Não foi possível registrar a denúncia. Revise os campos e tente novamente.',
        SELF_REPORT: 'A pessoa não pode denunciar a própria meta.',
        NO_OBJECTIVE: 'Essa categoria está sem meta cadastrada no momento.',
        DUPLICATE_REPORT: 'Essa pessoa já denunciou essa meta.',
        ALREADY_FLAGGED: 'Essa meta já foi invalidada pelo VAR e está oculta até ser alterada.',
        PARTICIPANT_NOT_FOUND: 'Participante não encontrado para registrar a denúncia.',
      };

      window.alert(messages[reportResult.reason] || 'Não foi possível registrar a denúncia.');
      return;
    }

    const targetParticipant = getParticipantById(mgmtData.participantId);
    const category = MGMT_CATEGORIES.find((item) => item.key === mgmtData.categoryKey);

    createSnapshot(
      reportResult.flagged
        ? `VAR acionado: ${targetParticipant?.name || 'participante'} (${category?.title || mgmtData.categoryKey})`
        : `Denúncia registrada: ${targetParticipant?.name || 'participante'} (${category?.title || mgmtData.categoryKey})`,
    );

    renderDashboard();
    mgmtData.reporterId = '';
    renderManagementStep();

    window.alert(
      reportResult.flagged
        ? `Terceira denúncia registrada. A meta de ${targetParticipant?.name || 'participante'} agora aparece como "${OBJECTIVE_VAR_PLACEHOLDER}" até ser alterada.`
        : `Denúncia registrada com sucesso. Essa meta está com ${reportResult.count}/${VAR_REPORT_THRESHOLD} denúncias.`,
    );
    return;
  }

  if (mgmtFlow === 'ADD_WEEKLY_FACT') {
    mgmtData.date = $('#mgmt-weekly-date')?.value || '';
    mgmtData.bestParticipantId = $('#mgmt-best-participant')?.value || '';
    mgmtData.bestDescription = $('#mgmt-best-description')?.value.trim() || '';
    mgmtData.worstParticipantId = $('#mgmt-worst-participant')?.value || '';
    mgmtData.worstDescription = $('#mgmt-worst-description')?.value.trim() || '';

    if (
      !mgmtData.date
      || !mgmtData.bestParticipantId
      || !hasMeaningfulWeeklyFactDescription(mgmtData.bestDescription)
      || !mgmtData.worstParticipantId
      || !hasMeaningfulWeeklyFactDescription(mgmtData.worstDescription)
    ) {
      window.alert('Preencha data, responsável e descrições válidas para o melhor e o pior fato. Apenas "." não é permitido.');
      return;
    }

    const bestParticipant = getParticipantsData().find((participant) => participant.id === mgmtData.bestParticipantId);
    const worstParticipant = getParticipantsData().find((participant) => participant.id === mgmtData.worstParticipantId);

    recordWeeklyFactHistory({
      id: mgmtData.date,
      date: mgmtData.date,
      best: {
        participantId: mgmtData.bestParticipantId,
        label: bestParticipant?.name || '',
        description: mgmtData.bestDescription,
      },
      worst: {
        participantId: mgmtData.worstParticipantId,
        label: worstParticipant?.name || '',
        description: mgmtData.worstDescription,
      },
    });

    createSnapshot('Fato da semana registrado');
    $('#management-modal').style.display = 'none';
    renderDashboard();
    return;
  }

  if (mgmtFlow === 'ADD_PARTICIPANT') {
    if (mgmtStep === 0) {
      mgmtData.name = $('#mgmt-name').value.trim();
      mgmtData.handle = $('#mgmt-handle').value.trim();
      try {
        mgmtData.photoUrl = await getPhotoValueFromUpload({ input: $('#mgmt-photoFile') });
      } catch (error) {
        window.alert(error.message || 'Não foi possível processar a imagem selecionada.');
        return;
      }

      if (!mgmtData.name || !mgmtData.handle) return alert('Preencha os campos obrigatórios');
      mgmtStep++;
      renderManagementStep();
    } else if (mgmtStep <= MGMT_CATEGORIES.length) {
      const cat = MGMT_CATEGORIES[mgmtStep - 1];
      mgmtData.objectives[cat.key] = $('#mgmt-objective').value.trim();
      
      if (mgmtStep === MGMT_CATEGORIES.length) {
        addParticipant(mgmtData);
        createSnapshot(`Participante adicionado: ${mgmtData.name}`);
        $('#management-modal').style.display = 'none';
        refreshDashboard();
      } else {
        mgmtStep++;
        renderManagementStep();
      }
    }
  } else if (mgmtFlow === 'NEW_CYCLE') {
    const participant = mgmtData.participants[mgmtData.currentIndex];
    const cat = MGMT_CATEGORIES[mgmtData.currentCatIndex];
    const objText = $('#mgmt-objective').value.trim();

    participant.objectives[cat.key] = objText;

    const isLastCat = mgmtData.currentCatIndex === MGMT_CATEGORIES.length - 1;
    const isLastParticipant = mgmtData.currentIndex === mgmtData.participants.length - 1;

    if (isLastCat && isLastParticipant) {
      for (const p of mgmtData.participants) {
        updateParticipantObjectives(p.id, p.objectives);
      }
      $('#management-modal').style.display = 'none';
      refreshDashboard();
    } else {
      if (isLastCat) {
        mgmtData.currentIndex++;
        mgmtData.currentCatIndex = 0;
      } else {
        mgmtData.currentCatIndex++;
      }
      mgmtStep++;
      renderManagementStep();
    }
  }
}

async function handleResetScores() {
  const confirmed = window.confirm(
    'Isso vai zerar a classificação atual do Best of The Week no dashboard. Deseja continuar?',
  );

  if (!confirmed) return;

  const startButton = $('#start-voting-btn');
  const resetButton = $('#reset-scores-btn');

  setButtonBusy(startButton, true, 'Zerando...');
  setButtonBusy(resetButton, true, 'Zerando...');

  await resetAllScores();
  createSnapshot('Pontuação zerada');
  renderDashboard();

  setButtonBusy(startButton, false, 'Zerando...');
  setButtonBusy(resetButton, false, 'Zerando...');
}

function startVotingSystem() {
  sessionResults = {};
  currentCategoryIndex = 0;
  botwStep = 'SPEAKING';
  bestWinnerId = null;
  worstWinnerId = null;
  pendingWeeklyFactEntry = null;
  navigationHistory = [];
  if ($('#weekly-facts-date')) $('#weekly-facts-date').value = formatDateForInput();
  if ($('#weekly-best-description')) $('#weekly-best-description').value = '';
  if ($('#weekly-worst-description')) $('#weekly-worst-description').value = '';

  prepareQueueForCategory(currentCategoryIndex);
  $('#voting-modal').style.display = 'flex';
  renderVotingStep();
}

function prepareQueueForCategory(categoryIndex) {
  const category = CATEGORIES_ORDER[categoryIndex];
  const participants = getParticipantsData();

  const pool = participants.filter((participant) => {
    if (category.key === 'bestWeek') return true;
    const obj = participant.objectives?.[category.key];
    return obj && String(obj).trim() !== '';
  });

  pool.sort(() => Math.random() - 0.5);

  currentQueue = pool;
  currentParticipantIndex = 0;
}

function renderVotingStep() {
  if (currentParticipantIndex >= currentQueue.length) {
    const category = CATEGORIES_ORDER[currentCategoryIndex];

    if (category.key === 'bestWeek' && botwStep === 'SPEAKING') {
      renderBOTWSelection('BEST');
      return;
    }

    currentCategoryIndex += 1;
    if (currentCategoryIndex < CATEGORIES_ORDER.length) {
      prepareQueueForCategory(currentCategoryIndex);
      renderVotingStep();
      return;
    }

    showFinishScreen();
    return;
  }

  const category = CATEGORIES_ORDER[currentCategoryIndex];
  const participant = currentQueue[currentParticipantIndex];

  $('#modal-participant-content').style.display = 'block';
  $('#modal-selection-grid').style.display = 'none';
  $('#modal-history-capture').style.display = 'none';
  $('#modal-celebration-screen').style.display = 'none';

  $('#modal-cat-title').textContent = category.title;
  $('#modal-cat-icon').textContent = category.icon;
  $('#modal-progress').textContent = `${currentParticipantIndex + 1} / ${currentQueue.length}`;
  setAvatarContent($('#modal-avatar'), participant);
  $('#modal-name').textContent = participant.name;

  if (category.key === 'bestWeek') {
    $('#modal-objective-label').textContent = 'Momento da Fala:';
    $('#modal-objective-text').textContent = 'Diga seu MELHOR e PIOR fato da semana!';
    $('#modal-actions-voting').style.display = 'none';
    $('#modal-actions-speaker').style.display = 'flex';
    setNavigationActions({ skipLabel: 'Pular participante ausente' });
  } else {
    const objectiveState = getObjectiveDisplayState(participant, category.key);
    $('#modal-objective-label').textContent = 'Objetivo da Semana:';
    $('#modal-objective-text').textContent = objectiveState.text;
    $('#modal-actions-voting').style.display = 'flex';
    $('#modal-actions-speaker').style.display = 'none';
    setNavigationActions({ skipLabel: 'Pular participante ausente' });
  }

  $('#modal-actions-finish').style.display = 'none';
  $('#modal-actions-history').style.display = 'none';
}

function renderBOTWSelection(type, isFirstVoter = true) {
  botwStep = type === 'BEST' ? 'BEST_WINNER' : 'WORST_WINNER';

  if (isFirstVoter) {
    currentVoterIndex = 0;
    botwVotes = {};
    getParticipantsData().forEach((participant) => {
      botwVotes[participant.id] = 0;
    });
  }

  const currentVoter = getParticipantsData()[currentVoterIndex];

  $('#modal-participant-content').style.display = 'none';
  $('#modal-selection-grid').style.display = 'grid';
  $('#modal-history-capture').style.display = 'none';
  $('#modal-actions-speaker').style.display = 'none';
  $('#modal-actions-voting').style.display = 'none';
  $('#modal-actions-finish').style.display = 'none';
  $('#modal-actions-history').style.display = 'none';
  $('#modal-cat-title').textContent = type === 'BEST' ? 'Quem teve o MELHOR fato?' : 'Quem teve o PIOR fato?';
  $('#modal-cat-icon').textContent = type === 'BEST' ? '🥇' : '💀';
  $('#modal-progress').innerHTML = `<span>Votando: ${currentVoter.name}</span> (${currentVoterIndex + 1}/${getParticipantsData().length})`;
  setNavigationActions({ skipLabel: 'Pular votante ausente' });

  const grid = $('#modal-selection-grid');
  grid.innerHTML = '';

  getParticipantsData().forEach((participant) => {
    const item = document.createElement('div');
    item.className = 'selection-item';
    item.innerHTML = `
      ${buildAvatarMarkup(participant, 'item-avatar')}
      <span class="selection-item-name">${participant.name}</span>
    `;

    item.addEventListener('click', () => castBOTWVote(participant.id, type));

    grid.appendChild(item);
  });
}

function finalizeBOTWSelection(type) {
  const totalVotes = Object.values(botwVotes).reduce((sum, value) => sum + Number(value || 0), 0);

  if (totalVotes <= 0) {
    if (type === 'BEST') {
      renderBOTWSelection('WORST');
      return;
    }

    currentCategoryIndex += 1;
    if (currentCategoryIndex < CATEGORIES_ORDER.length) {
      prepareQueueForCategory(currentCategoryIndex);
      renderVotingStep();
      return;
    }

    showFinishScreen();
    return;
  }

  const winnerId = Object.keys(botwVotes).reduce((bestId, candidateId) => (
    botwVotes[bestId] >= botwVotes[candidateId] ? bestId : candidateId
  ));
  const winner = getParticipantsData().find((candidate) => candidate.id === winnerId);

  if (!winner) {
    renderCurrentGameState();
    return;
  }

  if (!sessionResults[winnerId]) {
    sessionResults[winnerId] = {};
  }

  sessionResults[winnerId].bestWeek = (sessionResults[winnerId].bestWeek || 0) + (type === 'BEST' ? 1 : -1);

  if (type === 'BEST') {
    bestWinnerId = winnerId;
  } else {
    worstWinnerId = winnerId;
  }

  showCelebrationScreen(winner, type, () => {
    if (type === 'BEST') {
      renderBOTWSelection('WORST');
      return;
    }

    showWeeklyFactCaptureStep();
  });
}

function castBOTWVote(participantId, type, { shouldSnapshot = true } = {}) {
  if (shouldSnapshot) {
    pushGameStateSnapshot();
  }

  botwVotes[participantId] = (botwVotes[participantId] || 0) + 1;
  currentVoterIndex += 1;

  if (currentVoterIndex < getParticipantsData().length) {
    renderBOTWSelection(type, false);
    return;
  }

  finalizeBOTWSelection(type);
}

function showCelebrationScreen(participant, type, callback) {
  const screen = $('#modal-celebration-screen');
  const particlesContainer = $('#celebration-particles');
  const avatar = $('#celebration-avatar');
  const title = $('#celebration-title');
  const name = $('#celebration-name');
  const subtitle = $('#celebration-subtitle');

  particlesContainer.innerHTML = '';
  screen.style.display = 'flex';
  setAvatarContent(avatar, participant);
  name.textContent = participant.name;

  if (type === 'BEST') {
    playSFX('win');
    title.textContent = 'WINNER!';
    title.style.color = '#FFD700';
    title.style.textShadow = '0 0 20px rgba(255, 215, 0, 0.6)';
    subtitle.textContent = 'Melhor Fato da Semana';
    generateParticles(['🎉', '🎊', '✨', '⭐', '🏆', '🔥'], 'fall');
  } else {
    playSFX('shame');
    title.textContent = 'SHAME!';
    title.style.color = '#4CAF50';
    title.style.textShadow = '0 0 20px rgba(76, 175, 80, 0.6)';
    subtitle.textContent = 'Pior Fato da Semana';
    generateParticles(['💩', '💨', '🤢', '🤢', '🤮'], 'rise');
  }

  setTimeout(() => {
    screen.style.display = 'none';
    callback();
  }, 3000);
}

function playSFX(type) {
  const audio = SFX[type];
  if (!audio) return;

  audio.currentTime = 0;
  audio.play().catch((error) => console.log('Audio play blocked or failed:', error));

  setTimeout(() => {
    audio.pause();
    audio.currentTime = 0;
  }, 3000);
}

function generateParticles(list, direction) {
  const container = $('#celebration-particles');
  const count = 40;

  for (let index = 0; index < count; index += 1) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.textContent = list[Math.floor(Math.random() * list.length)];
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animation = `${direction === 'fall' ? 'particle-fall' : 'particle-rise'} ${2 + Math.random() * 3}s linear infinite`;
    particle.style.animationDelay = `${Math.random() * 2}s`;
    particle.style.opacity = '0';
    container.appendChild(particle);
  }
}

function handleVote(points) {
  pushGameStateSnapshot();

  const participant = currentQueue[currentParticipantIndex];
  const category = CATEGORIES_ORDER[currentCategoryIndex];

  if (!sessionResults[participant.id]) {
    sessionResults[participant.id] = {};
  }

  sessionResults[participant.id][category.key] = points;
  currentParticipantIndex += 1;
  renderVotingStep();
}

function handleAdvanceSpeaker() {
  pushGameStateSnapshot();
  currentParticipantIndex += 1;
  renderVotingStep();
}

function handleBackStep() {
  const previousState = navigationHistory.pop();

  if (!previousState) return;

  restoreGameState(previousState);
  renderCurrentGameState();
}

function handleSkipStep() {
  if (currentCategoryIndex >= CATEGORIES_ORDER.length) return;

  if (botwStep === 'DESCRIPTION_CAPTURE') {
    return;
  }

  const botwType = botwStep === 'BEST_WINNER'
    ? 'BEST'
    : botwStep === 'WORST_WINNER'
      ? 'WORST'
      : null;

  if (botwType) {
    pushGameStateSnapshot();
    currentVoterIndex += 1;

    if (currentVoterIndex < getParticipantsData().length) {
      renderBOTWSelection(botwType, false);
      return;
    }

    finalizeBOTWSelection(botwType);
    return;
  }

  const category = CATEGORIES_ORDER[currentCategoryIndex];

  if (category.key === 'bestWeek') {
    pushGameStateSnapshot();
    currentParticipantIndex += 1;
    renderVotingStep();
    return;
  }

  handleVote(0);
}

function showWeeklyFactCaptureStep() {
  const bestWinner = getParticipantsData().find((participant) => participant.id === bestWinnerId);
  const worstWinner = getParticipantsData().find((participant) => participant.id === worstWinnerId);

  if (!bestWinner || !worstWinner) {
    currentCategoryIndex += 1;
    botwStep = 'SPEAKING';

    if (currentCategoryIndex < CATEGORIES_ORDER.length) {
      prepareQueueForCategory(currentCategoryIndex);
      renderVotingStep();
      return;
    }

    showFinishScreen();
    return;
  }

  botwStep = 'DESCRIPTION_CAPTURE';
  $('#modal-participant-content').style.display = 'none';
  $('#modal-selection-grid').style.display = 'none';
  $('#modal-history-capture').style.display = 'block';
  $('#modal-celebration-screen').style.display = 'none';
  $('#modal-cat-title').textContent = 'Registrar fatos da semana';
  $('#modal-cat-icon').textContent = '📝';
  $('#modal-progress').textContent = 'Salvar descrições do melhor e pior fato';
  $('#weekly-best-summary').innerHTML = buildWinnerSummaryMarkup(bestWinner);
  $('#weekly-worst-summary').innerHTML = buildWinnerSummaryMarkup(worstWinner);

  const dateInput = $('#weekly-facts-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = formatDateForInput();
  }

  $('#modal-actions-voting').style.display = 'none';
  $('#modal-actions-speaker').style.display = 'none';
  $('#modal-actions-finish').style.display = 'none';
  $('#modal-actions-history').style.display = 'flex';
  setNavigationActions({ showBack: true, showSkip: false });
}

function showFinishScreen() {
  $('#modal-participant-content').style.display = 'block';
  $('#modal-selection-grid').style.display = 'none';
  $('#modal-history-capture').style.display = 'none';
  $('#modal-celebration-screen').style.display = 'none';
  $('#modal-cat-title').textContent = 'Votação Concluída!';
  $('#modal-cat-icon').textContent = '🏆';
  $('#modal-progress').textContent = '';
  setAvatarContent($('#modal-avatar'), null, '✅');
  $('#modal-name').textContent = 'Todos os objetivos revisados';
  $('#modal-objective-label').textContent = 'Sincronização';
  $('#modal-objective-text').textContent = pendingWeeklyFactEntry
    ? 'Clique em finalizar para aplicar os pontos no ranking e registrar os fatos da semana.'
    : 'Clique em finalizar para aplicar os pontos no ranking.';
  $('#modal-actions-voting').style.display = 'none';
  $('#modal-actions-speaker').style.display = 'none';
  $('#modal-actions-finish').style.display = 'flex';
  $('#modal-actions-history').style.display = 'none';
  setNavigationActions({ showBack: true, showSkip: false });
}

function handleSaveWeeklyFactHistory() {
  const date = $('#weekly-facts-date')?.value;
  const bestDescription = $('#weekly-best-description')?.value.trim();
  const worstDescription = $('#weekly-worst-description')?.value.trim();
  const bestWinner = getParticipantsData().find((participant) => participant.id === bestWinnerId);
  const worstWinner = getParticipantsData().find((participant) => participant.id === worstWinnerId);

  if (!date || !hasMeaningfulWeeklyFactDescription(bestDescription) || !hasMeaningfulWeeklyFactDescription(worstDescription)) {
    window.alert('Preencha a data e duas descrições válidas para salvar o histórico da semana. Apenas "." não é permitido.');
    return;
  }

  pendingWeeklyFactEntry = {
    id: date,
    date,
    best: {
      participantId: bestWinnerId,
      label: bestWinner?.name || '',
      description: bestDescription,
    },
    worst: {
      participantId: worstWinnerId,
      label: worstWinner?.name || '',
      description: worstDescription,
    },
  };

  if ($('#weekly-facts-date')) $('#weekly-facts-date').value = formatDateForInput();
  if ($('#weekly-best-description')) $('#weekly-best-description').value = '';
  if ($('#weekly-worst-description')) $('#weekly-worst-description').value = '';

  botwStep = 'SPEAKING';
  currentCategoryIndex += 1;

  if (currentCategoryIndex < CATEGORIES_ORDER.length) {
    prepareQueueForCategory(currentCategoryIndex);
    renderVotingStep();
    return;
  }

  showFinishScreen();
}

async function finishVotingSystem() {
  const finishButton = $('#btn-finish-voting');
  const modalCloseButton = $('#modal-close-btn');

  finishButton.disabled = true;
  finishButton.textContent = 'Salvando...';
  modalCloseButton.disabled = true;

  await persistVotingSession({
    sessionResults,
    bestWinnerId,
    worstWinnerId,
    voteDate: new Date().toISOString(),
  });

  if (pendingWeeklyFactEntry) {
    recordWeeklyFactHistory(pendingWeeklyFactEntry);
  }

  createSnapshot('Votação finalizada');
  pendingWeeklyFactEntry = null;

  $('#voting-modal').style.display = 'none';
  renderDashboard();

  finishButton.disabled = false;
  finishButton.textContent = 'Finalizar Votação';
  modalCloseButton.disabled = false;
}

// ===========================================================================
// Goals System — "Adicionar minhas metas"
// ===========================================================================

const GOALS_FORM_CATEGORIES = CATEGORY_DEFINITIONS.filter(c => c.key !== 'bestWeek');

let goalsStep = 0; // 0 = tutorial, 1 = form
let goalsSelectedParticipantId = '';
let goalsCountdownInterval = null;

function getGoalsTimeRemaining() {
  return null;
}

function isGoalsWindowActive() {
  return true;
}

function syncGoalsButtonState() {
  const goalsActionBtn = $('#mgmt-goals-btn');
  const goalsPanel = $('#mgmt-goals-panel');
  const goalsChip = $('#mgmt-goals-chip');
  const goalsStatus = $('#mgmt-goals-status');
  const goalsMeta = $('#mgmt-goals-meta');
  const goalsCountdown = $('#mgmt-goals-countdown');

  if (goalsActionBtn) {
    goalsActionBtn.textContent = 'Registrar metas';
  }

  if (goalsPanel) {
    goalsPanel.classList.add('is-open');
    goalsPanel.classList.remove('is-closed');
  }

  if (goalsChip) {
    goalsChip.textContent = 'Sempre aberto';
    goalsChip.classList.add('is-open');
    goalsChip.classList.remove('is-closed');
  }

  if (goalsStatus) {
    goalsStatus.textContent = 'O registro de metas fica liberado o tempo todo.';
  }

  if (goalsMeta) {
    goalsMeta.textContent = 'Os participantes podem criar ou editar as metas sempre que precisarem.';
  }

  if (goalsCountdown) {
    goalsCountdown.hidden = true;
  }
}

function startGoalsCountdown() {
  syncGoalsButtonState();
  if (goalsCountdownInterval) {
    clearInterval(goalsCountdownInterval);
    goalsCountdownInterval = null;
  }
}

function openGoalsModal() {
  if (!isGoalsWindowActive()) return;
  goalsStep = 0;
  goalsSelectedParticipantId = '';
  $('#goals-modal').style.display = 'flex';
  renderGoalsStep();
}

function renderGoalsStep() {
  const content = $('#goals-modal-content');
  const btnBack = $('#goals-btn-back');
  const btnNext = $('#goals-btn-next');

  if (goalsStep === 0) {
    // Tutorial
    btnBack.style.display = 'none';
    btnNext.textContent = 'Começar a registrar minhas metas';
    $('#goals-modal-icon').textContent = '📋';
    $('#goals-modal-title').textContent = 'Como registrar suas metas';

    content.innerHTML = `
      <div class="goals-tutorial">
        <div class="goals-tutorial-step">
          <div class="goals-tutorial-num">1</div>
          <div class="goals-tutorial-text">
            <strong>Selecione o seu nome</strong> na lista de participantes para que suas metas fiquem vinculadas a você.
            <span class="goals-tutorial-example">Caso não ache seu perfil, volte à tela inicial e peça para ser adicionado como participante.</span>
          </div>
        </div>

        <div class="goals-tutorial-step">
          <div class="goals-tutorial-num">2</div>
          <div class="goals-tutorial-text">
            <strong>Seja específico</strong> na sua meta. Quanto mais claro, melhor para ser avaliado.
            <span class="goals-tutorial-example">✅ Exercício: Fazer 5 treinos de musculação e/ou corrida na semana</span>
          </div>
        </div>

        <div class="goals-tutorial-step">
          <div class="goals-tutorial-num">3</div>
          <div class="goals-tutorial-text">
            <strong>Preencha todas as categorias.</strong> Se deixar alguma sem meta, ela vai contabilizar <strong>–2 pontos</strong> na soma da semana.
          </div>
        </div>

        <div class="goals-tutorial-step">
          <div class="goals-tutorial-num">4</div>
          <div class="goals-tutorial-text">
            As metas precisam ser <strong>claras, mensuráveis e semanais.</strong>
            <span class="goals-tutorial-example goals-tutorial-bad">❌ Saúde: Começar na academia (não dá pra "começar" toda semana)</span>
          </div>
        </div>

        <div class="goals-tutorial-step">
          <div class="goals-tutorial-num">5</div>
          <div class="goals-tutorial-text">
            As metas devem ser <strong>desafiadoras.</strong> Se já faz parte da sua rotina, não é uma meta.
          </div>
        </div>

        <div class="goals-tutorial-warn">
          ⚠️ Você pode criar ou editar suas metas sempre que precisar.
        </div>
      </div>
    `;
  } else if (goalsStep === 1) {
    // Form
    btnBack.style.display = 'flex';
    btnNext.textContent = 'Salvar metas';
    $('#goals-modal-icon').textContent = '🎯';
    $('#goals-modal-title').textContent = 'Registrar minhas metas';

    const participants = [...getParticipantsData()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const selectedParticipant = participants.find(p => p.id === goalsSelectedParticipantId);

    let headerHtml = '';
    if (selectedParticipant) {
      headerHtml = `
        <div class="goals-form-header">
          ${buildAvatarMarkup(selectedParticipant, 'item-avatar', getInitials(selectedParticipant.name))}
          <div class="goals-form-header-info">
            <span class="goals-form-header-name">${escapeHtml(selectedParticipant.name)}</span>
            <span class="goals-form-header-handle">${escapeHtml(selectedParticipant.handle)}</span>
          </div>
        </div>
      `;
    }

    const categoriesHtml = GOALS_FORM_CATEGORIES.map(cat => {
      const currentValue = selectedParticipant?.objectives?.[cat.key] || '';
      const isFlagged = selectedParticipant ? isObjectiveVarFlagged(selectedParticipant, cat.key) : false;
      return `
        <div class="goals-category-group">
          <div class="goals-category-label">
            <span class="goals-category-label-icon">${cat.icon}</span>
            ${cat.title}
          </div>
          <textarea
            class="goals-category-input"
            id="goals-cat-${cat.key}"
            placeholder="Ex: Meta semanal para ${cat.title}..."
            ${!selectedParticipant ? 'disabled' : ''}
          >${escapeHtml(currentValue)}</textarea>
          ${isFlagged ? '<div class="goals-category-warning">O VAR passou aqui. Altere o texto da meta para reativá-la.</div>' : ''}
        </div>
      `;
    }).join('');

    content.innerHTML = `
      <div class="mgmt-form-group">
        <label for="goals-participant-select">Selecione seu nome</label>
        <select id="goals-participant-select" class="mgmt-input">
          <option value="">Selecione um participante</option>
          ${participants.map(p => `
            <option value="${escapeHtml(p.id)}" ${p.id === goalsSelectedParticipantId ? 'selected' : ''}>
              ${escapeHtml(p.name)}
            </option>
          `).join('')}
        </select>
      </div>
      ${headerHtml}
      ${selectedParticipant ? categoriesHtml : '<p style="text-align: center; opacity: 0.5; padding: 16px 0;">Selecione um participante acima para preencher as metas.</p>'}
    `;

    // Bind participant select change
    $('#goals-participant-select')?.addEventListener('change', (e) => {
      goalsSelectedParticipantId = e.target.value;
      renderGoalsStep();
    });
  }
}

function handleGoalsBack() {
  if (goalsStep > 0) {
    goalsStep--;
    renderGoalsStep();
  }
}

function handleGoalsNext() {
  if (goalsStep === 0) {
    // Advance from tutorial to form
    goalsStep = 1;
    renderGoalsStep();
    return;
  }

  // Save goals
  if (!goalsSelectedParticipantId) {
    window.alert('Selecione seu nome na lista de participantes antes de salvar.');
    return;
  }

  const objectives = {};
  let hasEmpty = false;
  for (const cat of GOALS_FORM_CATEGORIES) {
    const value = $(`#goals-cat-${cat.key}`)?.value.trim() || '';
    objectives[cat.key] = value;
    if (!value) hasEmpty = true;
  }

  if (hasEmpty) {
    const proceed = window.confirm(
      'Atenção! Você deixou uma ou mais categorias sem meta.\n\nCategorias sem meta contabilizam –2 pontos por semana.\n\nDeseja salvar mesmo assim?'
    );
    if (!proceed) return;
  }

  updateParticipantObjectives(goalsSelectedParticipantId, objectives);
  const pName = getParticipantsData().find(p => p.id === goalsSelectedParticipantId)?.name || '';
  createSnapshot(`Metas atualizadas: ${pName}`);
  $('#goals-modal').style.display = 'none';
  renderDashboard();
  window.alert('Suas metas foram salvas com sucesso! 🎯');
}

// ===========================================================================
// Participant Profile Popup — click on name/avatar to see goals
// ===========================================================================

const PROFILE_CATEGORIES = CATEGORY_DEFINITIONS.filter(c => c.key !== 'bestWeek');

function showParticipantGoals(participantId) {
  const participant = getParticipantsData().find(p => p.id === participantId);
  if (!participant) return;

  // Remove existing popup if any
  const existing = $('#participant-profile-popup');
  if (existing) existing.remove();

  const goalsHtml = PROFILE_CATEGORIES.map(cat => {
    const objectiveState = getObjectiveDisplayState(participant, cat.key);
    return `
      <div class="profile-goal-item ${objectiveState.hasGoal ? '' : 'profile-goal-empty'} ${objectiveState.flagged ? 'profile-goal-flagged' : ''}">
        <div class="profile-goal-header">
          <span class="profile-goal-icon">${cat.icon}</span>
          <span class="profile-goal-cat">${cat.title}</span>
          <span class="profile-goal-pts">${participant.categories[cat.key]} pts</span>
        </div>
        <div class="profile-goal-text">${escapeHtml(objectiveState.text)}</div>
        ${objectiveState.flagged ? '<div class="profile-goal-flag-note">O VAR passou aqui. A meta só volta quando for alterada.</div>' : ''}
      </div>
    `;
  }).join('');

  const bestWeekPts = participant.categories.bestWeek;
  const mf = participant.scoreBreakdown?.melhorFato || 0;
  const pf = participant.scoreBreakdown?.piorFato || 0;

  const popup = document.createElement('div');
  popup.id = 'participant-profile-popup';
  popup.className = 'modal-backdrop';
  popup.style.display = 'flex';
  popup.innerHTML = `
    <div class="modal-card profile-popup-card">
      <button class="modal-close-btn" id="profile-popup-close">×</button>

      <div class="profile-popup-header">
        ${buildAvatarMarkup(participant, 'profile-popup-avatar')}
        <div class="profile-popup-name">${escapeHtml(participant.name)}</div>
        <div class="profile-popup-handle">${escapeHtml(participant.handle)}</div>
        <div class="profile-popup-points">
          <span class="profile-popup-total">${participant.totalPoints} pts</span>
          <span class="profile-popup-badge">🌟 BW: ${bestWeekPts} · MF: ${mf} · PF: ${pf}</span>
        </div>
      </div>

      <div class="modal-body profile-popup-body">
        <div class="profile-popup-section-title">Metas registradas</div>
        <div class="profile-goals-list">
          ${goalsHtml}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  popup.querySelector('#profile-popup-close').addEventListener('click', () => popup.remove());
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });
}

window.showParticipantGoals = showParticipantGoals;

// ===========================================================================
// Saves / Snapshots Popup
// ===========================================================================

async function openSavesPopup() {
  // Remove existing if any
  const existing = $('#saves-popup');
  if (existing) existing.remove();

  // Show loading state
  const loading = document.createElement('div');
  loading.id = 'saves-popup';
  loading.className = 'modal-backdrop';
  loading.style.display = 'flex';
  loading.innerHTML = `
    <div class="modal-card saves-popup-card">
      <div class="modal-header">
        <span class="modal-category-icon">💾</span>
        <h3 class="modal-category-title">Carregando salvamentos...</h3>
      </div>
    </div>
  `;
  document.body.appendChild(loading);

  const snapshots = await getSnapshots();
  loading.remove();

  const listHtml = snapshots.length === 0
    ? '<p class="saves-empty">Nenhum salvamento encontrado.<br>Os saves são criados automaticamente quando algo muda no jogo.</p>'
    : snapshots.map(s => {
        const date = new Date(s.timestamp);
        const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const pCount = s.participants?.length || 0;

        return `
          <div class="save-item">
            <div class="save-item-left">
              <div class="save-item-icon">💾</div>
              <div class="save-item-info">
                <div class="save-item-desc">${escapeHtml(s.description)}</div>
                <div class="save-item-meta">${dateStr} às ${timeStr} · ${pCount} participantes</div>
              </div>
            </div>
            <div class="save-item-actions">
              <button class="save-btn-restore" data-id="${s.id}" title="Restaurar este save">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                Restaurar
              </button>
              <button class="save-btn-delete" data-id="${s.id}" title="Excluir save">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join('');

  const popup = document.createElement('div');
  popup.id = 'saves-popup';
  popup.className = 'modal-backdrop';
  popup.style.display = 'flex';
  popup.innerHTML = `
    <div class="modal-card saves-popup-card">
      <button class="modal-close-btn" id="saves-popup-close">×</button>

      <div class="modal-header">
        <span class="modal-category-icon">💾</span>
        <h3 class="modal-category-title">Salvamentos</h3>
        <p style="font-size: 0.85rem; opacity: 0.6; margin-top: 2px;">${snapshots.length} save${snapshots.length !== 1 ? 's' : ''} encontrado${snapshots.length !== 1 ? 's' : ''}</p>
      </div>

      <div class="modal-body saves-popup-body">
        <button class="save-btn-manual" id="saves-btn-manual">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Criar save manual agora
        </button>
        <div class="saves-list">
          ${listHtml}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Close
  popup.querySelector('#saves-popup-close').addEventListener('click', () => popup.remove());
  popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });

  // Manual save
  popup.querySelector('#saves-btn-manual').addEventListener('click', async () => {
    createSnapshot('Salvamento manual');
    popup.remove();
    // Small delay so server has time to save
    setTimeout(() => openSavesPopup(), 600);
  });

  // Restore
  popup.querySelectorAll('.save-btn-restore').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const snapshot = snapshots.find(s => s.id === id);
      if (!snapshot) return;
      const confirmed = window.confirm(
        `Restaurar o save de "${snapshot.description}"?\n\nIsso vai substituir todos os dados atuais pelo estado desse salvamento.`
      );
      if (!confirmed) return;

      await restoreSnapshot(id);
      popup.remove();
      renderDashboard();
      window.alert('Save restaurado com sucesso! 🔄');
    });
  });

  // Delete
  popup.querySelectorAll('.save-btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (window.confirm('Excluir este salvamento?')) {
        await deleteSnapshot(id);
        popup.remove();
        openSavesPopup();
      }
    });
  });
}

window.openSavesPopup = openSavesPopup;
