import { createHash } from 'node:crypto';
import { requireAdmin, update } from './melhores-auth.js';
import { getStore } from '@netlify/blobs';

const revision = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');
const STORE_NAME = 'melhores-game';
const EMPTY_GAME_STATE = {
  participants: [],
  weeklyFactHistory: [],
  removedParticipantIds: [],
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function respond(payload, status = 200) {
  return { status, headers: corsHeaders(), body: payload };
}

// ---------------------------------------------------------------------------
// Internal blob helpers
// ---------------------------------------------------------------------------

async function getGameState() {
  const store = getStore({name:STORE_NAME,consistency:'strong'});
  const raw = await store.get('game-state');
  if (!raw) return { ...EMPTY_GAME_STATE };
  try {
    return {
      ...EMPTY_GAME_STATE,
      ...JSON.parse(raw),
    };
  } catch {
    return { ...EMPTY_GAME_STATE };
  }
}

async function setGameState(state) {
  const store = getStore({name:STORE_NAME,consistency:'strong'});
  await store.set('game-state', JSON.stringify(state));
}

async function getSaves() {
  const store = getStore({name:STORE_NAME,consistency:'strong'});
  const raw = await store.get('game-saves');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function setSaves(saves) {
  const store = getStore({name:STORE_NAME,consistency:'strong'});
  await store.set('game-saves', JSON.stringify(saves));
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/melhores/state — retorna o estado completo do jogo
 */
export async function handleMelhoresStateRequest(request = {}) {
  try {
    const denied = await requireAdmin(request);
    if (denied) return denied;
    const state = await getGameState();
    return respond({
      ok: true,
      revision: revision(state),
      participants: state.participants || [],
      weeklyFactHistory: state.weeklyFactHistory || [],
      removedParticipantIds: state.removedParticipantIds || [],
      source: 'server',
    });
  } catch (error) {
    console.error('[state] Error:', error);
    return respond({ ok: false, error: error.message, source: 'server' }, error.status||500);
  }
}

/**
 * POST /api/melhores/apply — salva o estado do jogo
 * Body: { participants, weeklyFactHistory }
 */
export async function handleMelhoresApplyRequest(body = {}, request = {}) {
  try {
    const denied = await requireAdmin(request);
    if (denied) return denied;
    const store=getStore({name:STORE_NAME,consistency:'strong'});
    const state=await update(store,'game-state',old=>{
      const current={...EMPTY_GAME_STATE,...(old||{})};
      if(!body.expectedRevision || body.expectedRevision!==revision(current))throw Object.assign(new Error('Os dados mudaram. Atualize a página antes de salvar.'),{status:409});
      if(body.participants!==undefined)current.participants=body.participants;
      if(body.weeklyFactHistory!==undefined)current.weeklyFactHistory=body.weeklyFactHistory;
      if(body.removedParticipantIds!==undefined)current.removedParticipantIds=body.removedParticipantIds;
      return current;
    });
    return respond({ok:true,revision:revision(state),source:'server'});
  } catch (error) {
    console.error('[apply] Error:', error);
    return respond({ ok: false, error: error.message, source: 'server' }, error.status||500);
  }
}

/**
 * POST /api/melhores/reset — zera o estado do jogo
 */
export async function handleMelhoresResetRequest(request = {}) {
  try {
    const denied = await requireAdmin(request);
    if (denied) return denied;
    await setGameState({ ...EMPTY_GAME_STATE });
    return respond({ ok: true, source: 'server' });
  } catch (error) {
    console.error('[reset] Error:', error);
    return respond({ ok: false, error: error.message, source: 'server' }, error.status||500);
  }
}

/**
 * GET|POST /api/melhores/saves — gerencia snapshots
 * GET  → retorna lista de saves
 * POST → body.action = 'create' | 'delete' | 'restore'
 */
export async function handleMelhoresSavesRequest(body = {}, method = 'GET', request = {}) {
  try {
    const denied = await requireAdmin(request);
    if (denied) return denied;
    let saves = await getSaves();

    // ---- LIST ----
    if (method === 'GET') {
      return respond({ ok: true, saves });
    }

    const { action } = body;

    // ---- CREATE ----
    if (action === 'create') {
      const snapshot = {
        id: `save_${Date.now()}`,
        timestamp: new Date().toISOString(),
        description: body.description || 'Salvamento manual',
        participants: body.participants || [],
        weeklyFactHistory: body.weeklyFactHistory || [],
        removedParticipantIds: body.removedParticipantIds || [],
      };
      saves.unshift(snapshot);
      if (saves.length > 50) saves.length = 50;
      await setSaves(saves);
      return respond({ ok: true, snapshot });
    }

    // ---- DELETE ----
    if (action === 'delete') {
      saves = saves.filter(s => s.id !== body.snapshotId);
      await setSaves(saves);
      return respond({ ok: true });
    }

    // ---- RESTORE ----
    if (action === 'restore') {
      const snapshot = saves.find(s => s.id === body.snapshotId);
      if (!snapshot) return respond({ ok: false, error: 'Snapshot not found' }, 404);

      // Backup current state before restoring
      const currentState = await getGameState();
      saves.unshift({
        id: `save_${Date.now()}`,
        timestamp: new Date().toISOString(),
        description: 'Backup antes de restauração',
        participants: currentState.participants || [],
        weeklyFactHistory: currentState.weeklyFactHistory || [],
        removedParticipantIds: currentState.removedParticipantIds || [],
      });
      if (saves.length > 50) saves.length = 50;
      await setSaves(saves);

      // Restore the snapshot
      await setGameState({
        participants: snapshot.participants || [],
        weeklyFactHistory: snapshot.weeklyFactHistory || [],
        removedParticipantIds: snapshot.removedParticipantIds || [],
      });

      return respond({
        ok: true,
        participants: snapshot.participants || [],
        weeklyFactHistory: snapshot.weeklyFactHistory || [],
        removedParticipantIds: snapshot.removedParticipantIds || [],
      });
    }

    return respond({ ok: false, error: 'Invalid action' }, 400);
  } catch (error) {
    console.error('[saves] Error:', error);
    return respond({ ok: false, error: error.message }, 500);
  }
}
