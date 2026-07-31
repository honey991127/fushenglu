// The reducer deliberately has no host or Node dependencies: it also runs in iOS WebViews.
export const CHARACTER_STATE_SCHEMA_VERSION = 2;

const OWNERSHIP = new Set(['owned', 'gifted', 'borrowed', 'temporary', 'unknown']);
const MAIN = new Set(['main', undefined, null]);

function copy(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function clean(value) { return String(value ?? '').trim(); }
function optional(value) { const result = clean(value); return result || null; }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function eventOrder(event, index) { return Number.isFinite(Number(event.storyOrder)) ? Number(event.storyOrder) : Number.isFinite(Number(event.sourceMessageIndex)) ? Number(event.sourceMessageIndex) : index; }
function stableHash(value) { let hash = 0x811c9dc5; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16); }

export function createCharacterState() {
  return {
    schemaVersion: CHARACTER_STATE_SCHEMA_VERSION,
    story: { schemaVersion: 2, currentTime: null, currentScenePlace: null, timelineHistory: [], time: null, place: null, ongoingStatuses: [], lastConfirmedChange: null },
    entities: { schemaVersion: 1, byId: {}, playerEntityId: 'entity:player' },
    places: { schemaVersion: 1, entries: [] },
    inventory: { schemaVersion: 1, currencies: [], items: [] },
    wardrobe: { schemaVersion: 1, garments: [], currentOutfit: null, savedOutfits: [] },
    skills: { schemaVersion: 1, entries: [] },
    cultivation: { schemaVersion: 1, current: null, milestones: [], breakthroughs: [] },
  };
}

function ensureEntity(state, event) {
  const value = event.value ?? {};
  const requestedType = clean(value.entityType ?? event.entityType);
  const isPlayer = requestedType === 'player' || value.owner === 'player' || value.subject === 'player' || event.subjectEntityId === 'entity:player';
  const name = optional(value.canonicalName ?? value.subjectName ?? value.person ?? value.name) ?? (isPlayer ? '玩家' : '未知人物');
  const entityId = clean(event.subjectEntityId ?? value.entityId) || (isPlayer ? 'entity:player' : `entity:npc:${stableHash(name)}`);
  const old = state.entities.byId[entityId];
  const aliases = new Set([...(old?.aliases ?? []), name, ...((Array.isArray(value.aliases) ? value.aliases : []).map(clean).filter(Boolean))]);
  state.entities.byId[entityId] = {
    schemaVersion: 1, entityId, entityType: isPlayer ? 'player' : (requestedType || old?.entityType || 'npc'), canonicalName: old?.canonicalName ?? name,
    aliases: [...aliases], aliasEvidence: [...(old?.aliasEvidence ?? []), ...(event.evidenceQuote ? [{ eventId: event.eventId, quote: event.evidenceQuote }] : [])],
    currentLocation: old?.currentLocation ?? null, durableStatuses: old?.durableStatuses ?? [], transientState: old?.transientState ?? null,
    relationships: old?.relationships ?? {}, possessions: old?.possessions ?? [], lastUpdatedStoryOrder: event.storyOrder ?? old?.lastUpdatedStoryOrder ?? null,
  };
  return entityId;
}

function upsertAmount(items, name, amount, key, event) {
  const index = items.findIndex((item) => item.name === name);
  const old = index >= 0 ? items[index] : null;
  const next = event.operation === 'set' ? amount : (old?.[key] ?? 0) + (event.operation === 'subtract' ? -amount : amount);
  if (next < 0) throw new RangeError(`${name} quantity cannot be below zero`);
  const entry = { schemaVersion: 1, ...(old ?? {}), name, [key]: next, updatedAt: event.createdAt, sourceEventId: event.eventId };
  if (index < 0) items.push(entry); else items[index] = entry;
}

function applyAsset(state, event) {
  const value = event.value ?? {};
  const player = state.entities.playerEntityId;
  const owner = clean(event.subjectEntityId ?? value.ownerEntityId ?? value.owner ?? value.subject);
  if (owner !== player && owner !== 'player') return; // Missing, mentioned, and NPC ownership never become player inventory.
  if (!MAIN.has(event.timelineContext) || value.negated || value.quantityUnknown) return;
  const name = optional(value.name ?? value.item ?? value.currency);
  const amount = number(value.quantity ?? value.amount ?? value.value);
  if (!name || amount === null || !['add', 'subtract', 'set'].includes(event.operation)) return;
  if (event.kind === 'currency') upsertAmount(state.inventory.currencies, name, amount, 'amount', event);
  else upsertAmount(state.inventory.items, name, amount, 'quantity', event);
}

function applyPerson(state, event) {
  const value = event.value ?? {};
  const id = ensureEntity(state, event);
  const entity = state.entities.byId[id];
  if (event.kind === 'person') {
    if (value.location || value.place) entity.currentLocation = optional(value.location ?? value.place);
    if (value.relationship && value.targetEntityId) entity.relationships[value.targetEntityId] = { dimension: optional(value.dimension) ?? 'relation', value: value.relationship, storyOrder: event.storyOrder };
    if (value.status) {
      if (value.transient) entity.transientState = { value: value.status, eventId: event.eventId, storyOrder: event.storyOrder };
      else if (event.operation === 'clear' || event.operation === 'resolve') entity.durableStatuses = entity.durableStatuses.filter((status) => status !== value.status);
      else entity.durableStatuses = [...new Set([...entity.durableStatuses, value.status])];
    }
  }
  entity.lastUpdatedStoryOrder = event.storyOrder ?? entity.lastUpdatedStoryOrder;
}

function applyStory(state, event) {
  const value = event.value ?? {};
  if (event.kind === 'story_time') {
    const time = optional(value.time ?? value.canonicalDisplay ?? value.description ?? value.label);
    if (!time) return;
    state.story.timelineHistory.push({ schemaVersion: 1, eventId: event.eventId, time, timelineContext: event.timelineContext ?? 'unknown', storyOrder: event.storyOrder });
    if (MAIN.has(event.timelineContext)) { state.story.currentTime = time; state.story.time = time; }
  }
  if (event.kind === 'place') {
    const place = optional(value.name ?? value.place ?? value.description);
    if (!place) return;
    if (!state.places.entries.some((entry) => entry.name === place)) state.places.entries.push({ schemaVersion: 1, name: place, eventId: event.eventId });
    if (MAIN.has(event.timelineContext)) { const subjectEntityId = clean(event.subjectEntityId ?? value.subjectEntityId); if (!subjectEntityId || subjectEntityId === 'entity:player') { state.story.currentScenePlace = place; state.story.place = place; } else { const entityId = ensureEntity(state, event); state.entities.byId[entityId].currentLocation = place; } }
  }
}

function applyOther(state, event) {
  const value = event.value ?? {};
  if (event.kind === 'wardrobe') {
    if (event.operation === 'wear') {
      const garmentNames = Array.isArray(value.garments) ? value.garments.map((item) => clean(item?.name ?? item)).filter(Boolean) : [];
      if (garmentNames.length && garmentNames.every((name) => state.wardrobe.garments.some((garment) => garment.name === name && garment.ownershipStatus === 'owned'))) state.wardrobe.currentOutfit = { schemaVersion: 1, name: optional(value.name), garmentNames, sourceEventId: event.eventId, updatedAt: event.createdAt };
      return;
    }
    const name = optional(value.name); if (!name || !['add', 'set', 'update'].includes(event.operation)) return;
    const ownershipStatus = value.ownershipStatus ?? 'owned'; if (!OWNERSHIP.has(ownershipStatus)) return;
    const entry = { schemaVersion: 1, name, part: optional(value.part) ?? 'other', ownershipStatus, updatedAt: event.createdAt, sourceEventId: event.eventId };
    const index = state.wardrobe.garments.findIndex((garment) => garment.name === name); if (index < 0) state.wardrobe.garments.push(entry); else state.wardrobe.garments[index] = entry;
  }
  if (event.kind === 'skill') { const name = optional(value.name); const proficiency = number(value.proficiency ?? value.value ?? value.amount); if (name && proficiency !== null) { const index = state.skills.entries.findIndex((skill) => skill.name === name); const old = state.skills.entries[index]; const next = event.operation === 'add' ? (old?.proficiency ?? 0) + proficiency : proficiency; if (index < 0) state.skills.entries.push({ schemaVersion: 1, name, proficiency: next }); else state.skills.entries[index] = { ...old, proficiency: next }; } }
  if (event.kind === 'cultivation') { const stage = optional(value.stage); if (stage) state.cultivation.current = { schemaVersion: 1, stage, eventId: event.eventId, confirmedAt: event.createdAt }; }
}

export function applyCharacterEvent(character, event) {
  const state = copy(character);
  if (!event || event.deletedAt !== null) return state;
  if (['inventory', 'currency'].includes(event.kind)) applyAsset(state, event);
  else if (event.kind === 'person') applyPerson(state, event);
  else if (['story_time', 'place'].includes(event.kind)) applyStory(state, event);
  else applyOther(state, event);
  state.story.lastConfirmedChange = { schemaVersion: 1, eventId: event.eventId, batchId: event.batchId, kind: event.kind, operation: event.operation, at: event.createdAt };
  return state;
}

export function rebuildCharacterState(events = []) {
  return events.filter((event) => event?.deletedAt === null).map((event, index) => ({ event, index })).sort((a, b) => eventOrder(a.event, a.index) - eventOrder(b.event, b.index) || String(a.event.eventId).localeCompare(String(b.event.eventId))).reduce((state, item) => applyCharacterEvent(state, item.event), createCharacterState());
}

// Pending is about ambiguity/conflict, not importance or proposal kind.
export function actionRequiresPending(_state, action) {
  const value = action.value ?? {};
  if (value.identityAmbiguous || value.ownershipAmbiguous || value.conflict || value.inferred || value.quantityUnknown || value.negatedAmbiguous) return true;
  if (['memory', 'quote', 'dream', 'hypothetical', 'unknown'].includes(action.timelineContext) && ['inventory', 'currency'].includes(action.kind)) return true;
  return false;
}

export function createCharacterAction({ actionId, kind, operation, value, dedupeKey, timestamp = new Date().toISOString() }) {
  if (!clean(actionId) || !clean(kind) || !clean(operation) || !clean(dedupeKey)) throw new TypeError('character action requires id, kind, operation and dedupeKey');
  return { schemaVersion: 2, actionId: clean(actionId), kind: clean(kind), operation: clean(operation), value: copy(value ?? {}), dedupeKey: clean(dedupeKey), selected: true, createdAt: timestamp };
}
