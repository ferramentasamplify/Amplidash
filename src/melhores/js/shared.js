export const CATEGORY_DEFINITIONS = [
  { key: 'bestWeek', title: 'Best of The Week', icon: '🌟' },
  { key: 'exercicio', title: 'Exercício Físico', icon: '💪' },
  { key: 'familia', title: 'Família', icon: '👨‍👩‍👧‍👦' },
  { key: 'alimentacao', title: 'Alimentação', icon: '🥗' },
  { key: 'hobbies', title: 'Hobbies', icon: '🎨' },
  { key: 'conhecimentos', title: 'Conhecimentos', icon: '📚' },
];

// Personal profiles and scores are read only from the authenticated API.
export const PARTICIPANT_PHOTOS_BY_ID = {};
export const PARTICIPANT_REGISTRY = [];
export const INITIAL_PARTICIPANTS_DATA = [];
const FALLBACK_PARTICIPANTS_DATA = [];

const PARTICIPANT_LOOKUP = new Map();

for (const participant of PARTICIPANT_REGISTRY) {
  PARTICIPANT_LOOKUP.set(normalizeLookup(participant.displayName), participant);
  PARTICIPANT_LOOKUP.set(normalizeLookup(participant.notionName), participant);

  for (const alias of participant.aliases) {
    PARTICIPANT_LOOKUP.set(normalizeLookup(alias), participant);
  }
}

export function normalizeLookup(value) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function cloneParticipants(participants) {
  return JSON.parse(JSON.stringify(participants));
}

export function createEmptyCategories() {
  return {
    exercicio: 0,
    familia: 0,
    alimentacao: 0,
    hobbies: 0,
    conhecimentos: 0,
    bestWeek: 0,
  };
}

export function createEmptyObjectives() {
  return {
    exercicio: null,
    familia: null,
    alimentacao: null,
    hobbies: null,
    conhecimentos: null,
  };
}

export function createEmptyScoreBreakdown() {
  return {
    melhorFato: 0,
    piorFato: 0,
  };
}

export function findParticipantDefinition(name) {
  if (!name) return null;

  const direct = PARTICIPANT_LOOKUP.get(normalizeLookup(name));
  if (direct) return direct;

  const normalized = normalizeLookup(name);

  for (const participant of PARTICIPANT_REGISTRY) {
    if (participant.aliases.some((alias) => normalized.startsWith(normalizeLookup(alias)))) {
      return participant;
    }
  }

  return null;
}

export function buildParticipantFromRegistry(participantId) {
  const definition = PARTICIPANT_REGISTRY.find((participant) => participant.id === participantId);

  if (!definition) return null;

  const fallback = FALLBACK_PARTICIPANTS_DATA.find((participant) => participant.id === participantId);

  return fallback
    ? cloneParticipants([fallback])[0]
    : {
        id: definition.id,
        name: definition.displayName,
        handle: definition.handle,
        photoUrl: definition.photoUrl || null,
        categories: createEmptyCategories(),
        objectives: createEmptyObjectives(),
        scoreBreakdown: createEmptyScoreBreakdown(),
      };
}

export function getParticipantNameById(participantId) {
  const participant = PARTICIPANT_REGISTRY.find((item) => item.id === participantId);
  return participant ? participant.displayName : participantId;
}
