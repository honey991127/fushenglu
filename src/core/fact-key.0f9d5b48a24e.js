function text(value) { return String(value ?? '').trim().toLowerCase(); }
export function createFactKey(candidate) {
  const value = candidate.value ?? {};
  const subject = text(candidate.subjectRef?.entityId ?? value.ownerEntityId ?? candidate.subjectEntityId);
  if (candidate.kind === 'story_time') return 'story:current-time';
  if (candidate.kind === 'place') return subject === 'entity:player' ? 'place:player:current' : 'place:entity:' + subject + ':current';
  if (candidate.kind === 'inventory') return ['inventory', subject, text(value.name), text(value.ownership), text(value.container), text(value.unit ?? value.quantity?.unit)].join(':');
  if (candidate.kind === 'currency') return ['currency', subject, text(value.name), text(value.unit)].join(':');
  if (candidate.kind === 'person_state') return ['person-state', subject, text(value.stateType), text(value.status)].join(':');
  if (candidate.kind === 'relationship') return ['relationship', subject, text(value.targetEntityId ?? value.targetName), text(value.dimension)].join(':');
  if (candidate.kind === 'world_rule') return 'world-rule:' + text(value.key ?? value.text);
  return [candidate.kind, subject, text(value.name ?? value.stage ?? value.status)].join(':');
}
