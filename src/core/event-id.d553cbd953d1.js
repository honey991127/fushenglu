function hash(value) { let h = 0x811c9dc5; for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }
export function createEventId({ messageRef, messageIndex, evidenceOrder, kind, operation, subjectEntityId, factKey }) {
  return 'event_' + hash([messageRef ?? '', messageIndex ?? -1, evidenceOrder ?? 0, kind, operation, subjectEntityId ?? '', factKey].join('|'));
}
