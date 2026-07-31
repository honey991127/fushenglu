// Pure history helpers; safe for the iOS WebView and independent of the host bridge.
const NON_MAIN = new Set(['memory', 'quote', 'dream', 'hypothetical', 'hearsay', 'plan', 'unknown']);

function clean(value) { const text = String(value ?? '').trim(); return text || null; }
function hashText(value) { let hash = 0x811c9dc5; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, '0'); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }

export function createStoryOrder({ messageIndex = 0, evidenceOrder = 0 } = {}) {
  const message = Number.isInteger(messageIndex) && messageIndex >= 0 ? messageIndex : 0;
  const evidence = Number.isInteger(evidenceOrder) && evidenceOrder >= 0 ? evidenceOrder : 0;
  return message * 1000 + evidence;
}

export function compareStoryOrder(left, right) {
  return createStoryOrder(left?.evidence ?? left) - createStoryOrder(right?.evidence ?? right)
    || String(left?.evidence?.messageRef ?? left?.messageRef ?? '').localeCompare(String(right?.evidence?.messageRef ?? right?.messageRef ?? ''));
}

export function createHistoryFingerprint(messages, chunks, pipelineVersion = 2) {
  const refs = messages.map((message) => String(message.messageRef ?? '')).join('\n');
  return {
    pipelineVersion,
    messageRefsHash: hashText(refs),
    branchFingerprint: hashText(messages.map((message) => `${message.messageRef}|${message.role}|${message.content}`).join('\n')),
    chunkBoundaries: chunks.map((chunk) => ({ firstMessageRef: chunk[0]?.messageRef ?? null, lastMessageRef: chunk.at(-1)?.messageRef ?? null })),
  };
}

export function canResumeHistoryImport(saved, fingerprint) {
  return Boolean(saved && saved.schemaVersion === 1
    && saved.pipelineVersion === fingerprint.pipelineVersion
    && saved.branchFingerprint === fingerprint.branchFingerprint
    && saved.messageRefsHash === fingerprint.messageRefsHash
    && JSON.stringify(saved.chunkBoundaries) === JSON.stringify(fingerprint.chunkBoundaries));
}

export function resolveIdentity(subjectRef = {}, identityContext = {}, worldRules = { entries: [] }) {
  const rawName = clean(subjectRef.rawName);
  if (subjectRef.entityId === 'entity:player' || subjectRef.role === 'player') return { entityId: 'entity:player', canonicalName: identityContext.player?.canonicalName ?? rawName, resolved: true };
  const playerAliases = new Set([identityContext.player?.canonicalName, ...(identityContext.player?.aliases ?? [])].map(clean).filter(Boolean));
  if (rawName && playerAliases.has(rawName)) return { entityId: 'entity:player', canonicalName: identityContext.player?.canonicalName ?? rawName, resolved: true };
  const confirmed = (worldRules.entries ?? []).filter((entry) => entry?.confirmed === true);
  const rule = confirmed.find((entry) => clean(entry.canonicalName) === rawName || (entry.aliases ?? []).map(clean).includes(rawName));
  if (rule?.entityId) return { entityId: rule.entityId, canonicalName: clean(rule.canonicalName) ?? rawName, resolved: true };
  return { entityId: clean(subjectRef.entityId), canonicalName: rawName, resolved: Boolean(clean(subjectRef.entityId)) };
}

export function buildRollingContext({ snapshot, identityContext, entities = {}, worldRules = { entries: [] }, factKeys = [] } = {}) {
  return {
    schemaVersion: 1,
    currentTime: snapshot?.currentTime ?? snapshot?.story?.currentTime ?? null,
    currentPlace: snapshot?.currentPlace ?? snapshot?.currentScenePlace ?? snapshot?.story?.currentScenePlace ?? null,
    player: identityContext?.player ?? null,
    entities: Object.values(entities.byId ?? entities).map((entity) => ({ entityId: entity.entityId, canonicalName: entity.canonicalName, aliases: entity.aliases ?? [], currentLocation: entity.currentLocation ?? null })),
    confirmedWorldRules: (worldRules.entries ?? []).filter((entry) => entry?.confirmed === true).map((entry) => ({ canonicalName: entry.canonicalName, aliases: entry.aliases ?? [], entityId: entry.entityId ?? null })),
    knownFactKeys: [...new Set(factKeys)].slice(-64),
  };
}

export function reduceCurrentSnapshot(candidates, previous = {}) {
  const snapshot = clone(previous);
  snapshot.currentTime ??= null;
  snapshot.currentPlace ??= null;
  snapshot.entities ??= {};
  snapshot.pending ??= [];
  for (const candidate of [...candidates].sort(compareStoryOrder)) {
    if (candidate.disposition !== 'apply' || NON_MAIN.has(candidate.timelineContext)) continue;
    const value = candidate.normalizedValue ?? candidate.value ?? {};
    if (candidate.kind === 'story_time') {
      const time = clean(value.time ?? value.display ?? value.dateText ?? value.timeText);
      if (time) snapshot.currentTime = time;
    } else if (candidate.kind === 'place') {
      const place = clean(value.name ?? value.place);
      const entityId = candidate.subjectRef?.entityId ?? candidate.subjectEntityId;
      if (place && (!entityId || entityId === 'entity:player')) snapshot.currentPlace = place;
      else if (place && entityId) snapshot.entities[entityId] = { ...(snapshot.entities[entityId] ?? {}), currentLocation: place };
    }
  }
  return snapshot;
}

export function prepareHistoryChunks(messages, split, { overlapMessages = 2, identityContext, rollingContext } = {}) {
  const base = split(messages);
  return base.map((chunk, index) => {
    const overlap = index === 0 ? [] : messages.slice(Math.max(0, messages.indexOf(chunk[0]) - overlapMessages), messages.indexOf(chunk[0]));
    return { chunkIndex: index, messages: [...overlap, ...chunk].map(clone), overlapMessageRefs: overlap.map((item) => item.messageRef), identityContext: clone(identityContext ?? null), rollingContext: clone(rollingContext ?? null) };
  });
}
