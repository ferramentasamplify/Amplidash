/**
 * data.js — Local-only state management (/melhores)
 *
 * REGRA DE OURO: O localStorage é a fonte da verdade.
 * Quando o usuário já tem dados salvos, NENHUMA propriedade numérica
 * (categories, scoreBreakdown) nem textual (objectives) é sobrescrita.
 * Apenas metadados visuais (name, handle, photoUrl) são preenchidos
 * caso estejam ausentes, usando os valores padrão como fallback.
 *
 * A única maneira de zerar os dados é o botão "Zerar pontuação"
 * que chama resetAllScores().
 */

import { calculateTotalScores } from './utils.js';
import { INITIAL_PARTICIPANTS_DATA, cloneParticipants } from './shared.js';

const STORAGE_KEY = 'amplify_melhores_v1';
const WEEKLY_FACT_HISTORY_STORAGE_KEY = 'amplify_melhores_history_v1';
const OBJECTIVE_CATEGORY_KEYS = ['exercicio', 'familia', 'alimentacao', 'hobbies', 'conhecimentos'];
export const VAR_REPORT_THRESHOLD = 3;
const REMOVED_PARTICIPANT_IDS = new Set(['vitor']);
const PARTICIPANT_DEFAULTS_BY_ID = new Map(
  INITIAL_PARTICIPANTS_DATA.map((participant) => [participant.id, participant]),
);

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------

function isStorageAvailable() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredState() {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Error reading local storage:', error);
    return null;
  }
}

function writeStoredState(state) {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Error writing local storage:', error);
  }
  scheduleSyncToServer();
}

function readStoredWeeklyFactHistory() {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(WEEKLY_FACT_HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Error reading weekly fact history from local storage:', error);
    return null;
  }
}

function writeStoredWeeklyFactHistory(entries) {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(WEEKLY_FACT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.error('Error writing weekly fact history to local storage:', error);
  }
  scheduleSyncToServer();
}

// ---------------------------------------------------------------------------
// Server sync layer — Netlify Blobs via API
// ---------------------------------------------------------------------------

const API_BASE = '/api/melhores';
let _syncTimer = null;
let _skipSync = false;

function scheduleSyncToServer() {
  if (_skipSync) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    fetch(`${API_BASE}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participants: participantState,
        weeklyFactHistory,
      }),
    }).catch((err) => console.warn('[sync] Server sync failed:', err.message));
  }, 400);
}

async function fetchServerState() {
  try {
    const res = await fetch(`${API_BASE}/state`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (never mutate storage)
// ---------------------------------------------------------------------------

function withTotals(participants) {
  return participants.map((participant) => ({
    ...participant,
    totalPoints: calculateTotalScores(participant.categories),
  }));
}

function normalizeObjectiveValue(value) {
  return String(value ?? '').trim();
}

function normalizeScoreValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function createScoreBreakdownFromBestWeek(bestWeekValue) {
  const bestWeek = normalizeScoreValue(bestWeekValue);
  return {
    melhorFato: bestWeek >= 0 ? bestWeek : 0,
    piorFato: bestWeek < 0 ? bestWeek : 0,
  };
}

function createEmptyObjectiveModeration() {
  return OBJECTIVE_CATEGORY_KEYS.reduce((accumulator, key) => {
    accumulator[key] = { reporterIds: [], flagged: false };
    return accumulator;
  }, {});
}

function normalizeObjectiveModeration(value) {
  const base = createEmptyObjectiveModeration();

  for (const key of OBJECTIVE_CATEGORY_KEYS) {
    const reporterIds = Array.isArray(value?.[key]?.reporterIds)
      ? [...new Set(value[key].reporterIds.filter(Boolean).map(String))]
      : [];

    base[key] = {
      reporterIds,
      flagged: Boolean(value?.[key]?.flagged) || reporterIds.length >= VAR_REPORT_THRESHOLD,
    };
  }

  return base;
}

function hydrateParticipantState(participants) {
  return withTotals(
    normalizeParticipantMetadata(participants).map((participant) => ({
      ...participant,
      objectiveModeration: normalizeObjectiveModeration(participant.objectiveModeration),
    })),
  );
}

/**
 * Garante que todo participante do INITIAL_PARTICIPANTS_DATA exista no array,
 * e preenche APENAS metadados visuais (name, handle, photoUrl) caso estejam
 * ausentes. Categorias, objetivos e scoreBreakdown NUNCA são tocados aqui.
 */
function normalizeParticipantMetadata(participants) {
  const existingIds = new Set(participants.map(p => p.id));

  // Adiciona participantes que existem nos padrões mas não estão no state salvo
  for (const [id, defaultData] of PARTICIPANT_DEFAULTS_BY_ID.entries()) {
    if (!existingIds.has(id) && !REMOVED_PARTICIPANT_IDS.has(id)) {
      participants.push(cloneParticipants([defaultData])[0]);
    }
  }

  return participants
    .filter((participant) => !REMOVED_PARTICIPANT_IDS.has(participant.id))
    .map((participant) => {
      const defaults = PARTICIPANT_DEFAULTS_BY_ID.get(participant.id);

      if (!defaults) {
        // Participante adicionado manualmente, sem defaults — manter tudo intacto
        return {
          ...participant,
          photoUrl: participant.photoUrl || null,
        };
      }

      // Preencher APENAS campos visuais ausentes — nunca sobrescrever dados do jogo
      return {
        ...participant,
        name: participant.name || defaults.name,
        handle: participant.handle || defaults.handle,
        photoUrl: participant.photoUrl ?? defaults.photoUrl ?? null,
      };
    });
}

function normalizeFactDescription(value) {
  return String(value || '').trim();
}

function hasMeaningfulFactDescription(value) {
  const normalized = normalizeFactDescription(value);
  return normalized !== '' && normalized !== '.';
}

function normalizeWeeklyFactHistory(entries) {
  const mergedEntriesById = new Map();

  for (const entry of entries || []) {
    if (!entry?.id) continue;
    mergedEntriesById.set(entry.id, {
      ...entry,
      best: {
        participantId: entry.best?.participantId || null,
        label: entry.best?.label || '',
        description: normalizeFactDescription(entry.best?.description),
      },
      worst: {
        participantId: entry.worst?.participantId || null,
        label: entry.worst?.label || '',
        description: normalizeFactDescription(entry.worst?.description),
      },
    });
  }

  return [...mergedEntriesById.values()]
    .filter((entry) => (
      entry?.date
      && hasMeaningfulFactDescription(entry.best?.description)
      && hasMeaningfulFactDescription(entry.worst?.description)
    ))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Initial hydration — localStorage as cache, server as source of truth
// ---------------------------------------------------------------------------

// Start with localStorage cache for instant render (sync happens in loadParticipantsData)
_skipSync = true;

let participantState = readStoredState();

if (!participantState) {
  participantState = cloneParticipants(INITIAL_PARTICIPANTS_DATA);
}

participantState = hydrateParticipantState(participantState);

let weeklyFactHistory = normalizeWeeklyFactHistory(readStoredWeeklyFactHistory() || []);

_skipSync = false;

// ---------------------------------------------------------------------------
// Public API — leitura
// ---------------------------------------------------------------------------

export function getParticipantsData() {
  return participantState;
}

export function getSourceInfo() {
  return {
    source: 'server',
    syncedAt: new Date().toISOString(),
    error: null,
  };
}

export function getWeeklyFactHistory() {
  return weeklyFactHistory;
}

/**
 * Carrega dados — tenta servidor primeiro, fallback para localStorage.
 * Na primeira vez, migra dados locais para o servidor automaticamente.
 */
export async function loadParticipantsData() {
  const serverData = await fetchServerState();

  if (serverData && serverData.participants && serverData.participants.length > 0) {
    // Server tem dados — usar como fonte da verdade
    _skipSync = true;

    participantState = hydrateParticipantState(serverData.participants);
    weeklyFactHistory = normalizeWeeklyFactHistory(serverData.weeklyFactHistory || []);

    // Atualiza cache local
    writeStoredState(participantState);
    writeStoredWeeklyFactHistory(weeklyFactHistory);

    _skipSync = false;
  } else {
    // Server vazio — usar dados locais + migrar para o servidor
    const local = readStoredState();
    if (local && local.length > 0) {
      participantState = hydrateParticipantState(local);
      weeklyFactHistory = normalizeWeeklyFactHistory(readStoredWeeklyFactHistory() || []);
      // Migrar para o servidor
      scheduleSyncToServer();
    }
  }

  return {
    participants: participantState,
    weeklyFactHistory,
    sourceInfo: getSourceInfo(),
  };
}

// ---------------------------------------------------------------------------
// Public API — escrita (todas salvam no localStorage imediatamente)
// ---------------------------------------------------------------------------

/**
 * Persiste os resultados de uma sessão de votação.
 * Soma os pontos ao estado existente e salva.
 */
export async function persistVotingSession({ sessionResults, bestWinnerId, worstWinnerId }) {
  participantState = participantState.map((participant) => {
    const result = sessionResults[participant.id] || {};
    const scoreBreakdown = { ...participant.scoreBreakdown };

    const categories = {
      ...participant.categories,
      exercicio: participant.categories.exercicio + Number(result.exercicio || 0),
      familia: participant.categories.familia + Number(result.familia || 0),
      alimentacao: participant.categories.alimentacao + Number(result.alimentacao || 0),
      hobbies: participant.categories.hobbies + Number(result.hobbies || 0),
      conhecimentos: participant.categories.conhecimentos + Number(result.conhecimentos || 0),
    };

    if (participant.id === bestWinnerId) {
      scoreBreakdown.melhorFato = (scoreBreakdown.melhorFato || 0) + 1;
    }

    if (participant.id === worstWinnerId) {
      scoreBreakdown.piorFato = (scoreBreakdown.piorFato || 0) - 1;
    }

    categories.bestWeek = (scoreBreakdown.melhorFato || 0) + (scoreBreakdown.piorFato || 0);

    return {
      ...participant,
      categories,
      scoreBreakdown,
    };
  });

  participantState = withTotals(participantState);
  writeStoredState(participantState);

  return {
    participants: participantState,
    weeklyFactHistory,
    sourceInfo: getSourceInfo(),
  };
}

/**
 * Registra um fato semanal (melhor + pior) no histórico e salva.
 */
export function recordWeeklyFactHistory(entry) {
  const normalizedEntry = {
    id: entry.id || entry.date,
    date: entry.date,
    best: {
      participantId: entry.best?.participantId || null,
      label: entry.best?.label || '',
      description: normalizeFactDescription(entry.best?.description),
    },
    worst: {
      participantId: entry.worst?.participantId || null,
      label: entry.worst?.label || '',
      description: normalizeFactDescription(entry.worst?.description),
    },
  };

  weeklyFactHistory = normalizeWeeklyFactHistory([...weeklyFactHistory, normalizedEntry]);
  writeStoredWeeklyFactHistory(weeklyFactHistory);

  return weeklyFactHistory;
}

/**
 * Adiciona um novo participante e salva imediatamente.
 */
export function addParticipant({ name, handle, photoUrl, objectives }) {
  const id = name.toLowerCase().replace(/\s+/g, '-');
  const newParticipant = {
    id,
    name,
    handle: handle.startsWith('@') ? handle : `@${handle}`,
    photoUrl: photoUrl || null,
    categories: {
      exercicio: 0,
      familia: 0,
      alimentacao: 0,
      hobbies: 0,
      conhecimentos: 0,
      bestWeek: 0,
    },
    objectives: {
      exercicio: objectives.exercicio || '',
      familia: objectives.familia || '',
      alimentacao: objectives.alimentacao || '',
      hobbies: objectives.hobbies || '',
      conhecimentos: objectives.conhecimentos || '',
    },
    objectiveModeration: createEmptyObjectiveModeration(),
    scoreBreakdown: {
      melhorFato: 0,
      piorFato: 0,
    },
  };

  participantState.push(withTotals([newParticipant])[0]);
  writeStoredState(participantState);
  return participantState;
}

/**
 * Remove um participante e salva imediatamente.
 */
export function removeParticipant(id) {
  participantState = participantState.filter((p) => p.id !== id);
  writeStoredState(participantState);
  return participantState;
}

/**
 * Atualiza os objetivos de um participante e salva imediatamente.
 */
export function updateParticipantObjectives(id, objectives) {
  participantState = participantState.map((p) => {
    if (p.id !== id) return p;

    const nextObjectiveModeration = normalizeObjectiveModeration(p.objectiveModeration);

    for (const [key, nextValue] of Object.entries(objectives || {})) {
      if (!OBJECTIVE_CATEGORY_KEYS.includes(key)) continue;

      const previousValue = normalizeObjectiveValue(p.objectives?.[key]);
      const incomingValue = normalizeObjectiveValue(nextValue);

      if (previousValue !== incomingValue) {
        nextObjectiveModeration[key] = { reporterIds: [], flagged: false };
      }
    }

    return {
      ...p,
      objectives: {
        ...p.objectives,
        ...objectives,
      },
      objectiveModeration: nextObjectiveModeration,
    };
  });
  writeStoredState(participantState);
  return participantState;
}

export function updateParticipantScores(id, categories) {
  participantState = withTotals(participantState.map((participant) => {
    if (participant.id !== id) return participant;

    const nextCategories = {
      ...participant.categories,
      exercicio: normalizeScoreValue(categories?.exercicio),
      familia: normalizeScoreValue(categories?.familia),
      alimentacao: normalizeScoreValue(categories?.alimentacao),
      hobbies: normalizeScoreValue(categories?.hobbies),
      conhecimentos: normalizeScoreValue(categories?.conhecimentos),
      bestWeek: normalizeScoreValue(categories?.bestWeek),
    };

    return {
      ...participant,
      categories: nextCategories,
      scoreBreakdown: createScoreBreakdownFromBestWeek(nextCategories.bestWeek),
    };
  }));

  writeStoredState(participantState);
  return participantState;
}

export function reportParticipantObjective({ reporterId, participantId, categoryKey }) {
  if (!reporterId || !participantId || !OBJECTIVE_CATEGORY_KEYS.includes(categoryKey)) {
    return { ok: false, reason: 'INVALID_INPUT' };
  }

  if (reporterId === participantId) {
    return { ok: false, reason: 'SELF_REPORT' };
  }

  let result = { ok: false, reason: 'PARTICIPANT_NOT_FOUND' };

  participantState = participantState.map((participant) => {
    if (participant.id !== participantId) return participant;

    const objectiveValue = normalizeObjectiveValue(participant.objectives?.[categoryKey]);
    if (!objectiveValue) {
      result = { ok: false, reason: 'NO_OBJECTIVE' };
      return participant;
    }

    const nextObjectiveModeration = normalizeObjectiveModeration(participant.objectiveModeration);
    const currentReview = nextObjectiveModeration[categoryKey];

    if (currentReview.flagged || currentReview.reporterIds.length >= VAR_REPORT_THRESHOLD) {
      result = {
        ok: false,
        reason: 'ALREADY_FLAGGED',
        count: currentReview.reporterIds.length,
      };
      return participant;
    }

    if (currentReview.reporterIds.includes(reporterId)) {
      result = {
        ok: false,
        reason: 'DUPLICATE_REPORT',
        count: currentReview.reporterIds.length,
      };
      return participant;
    }

    const reporterIds = [...currentReview.reporterIds, reporterId];
    const flagged = reporterIds.length >= VAR_REPORT_THRESHOLD;

    nextObjectiveModeration[categoryKey] = {
      reporterIds,
      flagged,
    };

    result = {
      ok: true,
      count: reporterIds.length,
      flagged,
      reporterIds,
    };

    return {
      ...participant,
      objectiveModeration: nextObjectiveModeration,
    };
  });

  if (!result.ok) {
    return result;
  }

  writeStoredState(participantState);
  return result;
}

/**
 * ZERAR PONTUAÇÃO — a ÚNICA função que apaga dados do jogo.
 * Mantém os participantes (nome, handle, foto), mas zera tudo mais.
 */
export async function resetAllScores() {
  participantState = participantState.map(p => ({
    ...p,
    categories: {
      exercicio: 0,
      familia: 0,
      alimentacao: 0,
      hobbies: 0,
      conhecimentos: 0,
      bestWeek: 0,
    },
    objectives: {
      exercicio: '',
      familia: '',
      alimentacao: '',
      hobbies: '',
      conhecimentos: '',
    },
    objectiveModeration: createEmptyObjectiveModeration(),
    scoreBreakdown: {
      melhorFato: 0,
      piorFato: 0,
    }
  }));

  participantState = withTotals(participantState);
  writeStoredState(participantState);

  weeklyFactHistory = [];
  writeStoredWeeklyFactHistory(weeklyFactHistory);

  return {
    participants: participantState,
    weeklyFactHistory,
    sourceInfo: getSourceInfo(),
  };
}

/**
 * Process the data: calculate totals and sort by category/total
 */
export function getCategorizedRankings() {
  const withCurrentTotals = withTotals(participantState);

  const sortBy = (arr, prop) => [...arr].sort((a, b) => b[prop] - a[prop]);
  const sortByCategory = (arr, categoryKey) =>
    [...arr].sort((a, b) => b.categories[categoryKey] - a.categories[categoryKey]);

  return {
    exercicio: sortByCategory(withCurrentTotals, 'exercicio'),
    familia: sortByCategory(withCurrentTotals, 'familia'),
    alimentacao: sortByCategory(withCurrentTotals, 'alimentacao'),
    hobbies: sortByCategory(withCurrentTotals, 'hobbies'),
    conhecimentos: sortByCategory(withCurrentTotals, 'conhecimentos'),
    bestWeek: sortByCategory(withCurrentTotals, 'bestWeek'),
    geral: sortBy(withCurrentTotals, 'totalPoints'),
  };
}

// ===========================================================================
// Snapshot / Save System — Server-synced
// ===========================================================================

/**
 * Creates a snapshot of the current game state (saved on server).
 */
export function createSnapshot(description = 'Salvamento manual') {
  // Fire-and-forget to server
  fetch(`${API_BASE}/saves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      description,
      participants: participantState,
      weeklyFactHistory,
    }),
  }).catch((err) => console.warn('[saves] Create failed:', err.message));
}

/**
 * Returns all saved snapshots from server (newest first).
 */
export async function getSnapshots() {
  try {
    const res = await fetch(`${API_BASE}/saves`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.ok ? (data.saves || []) : [];
  } catch {
    return [];
  }
}

/**
 * Restores the game state from a server snapshot.
 */
export async function restoreSnapshot(snapshotId) {
  try {
    const res = await fetch(`${API_BASE}/saves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', snapshotId }),
    });
    const data = await res.json();
    if (!data.ok) return false;

    _skipSync = true;
    participantState = hydrateParticipantState(data.participants || []);
    weeklyFactHistory = normalizeWeeklyFactHistory(data.weeklyFactHistory || []);
    writeStoredState(participantState);
    writeStoredWeeklyFactHistory(weeklyFactHistory);
    _skipSync = false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes a snapshot on the server by ID.
 */
export async function deleteSnapshot(snapshotId) {
  try {
    await fetch(`${API_BASE}/saves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', snapshotId }),
    });
  } catch (err) {
    console.warn('[saves] Delete failed:', err.message);
  }
}
