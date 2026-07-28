export const CHARACTER_STATE_SCHEMA_VERSION = 1;

const OWNERSHIP_STATUSES = new Set([
  'owned',
  'gifted',
  'borrowed',
  'temporary',
  'unknown',
]);

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function text(value, field) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new TypeError(`${field} is required`);
  }

  return normalized;
}

function nonNegative(value, field) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${field} must be a non-negative number`);
  }

  return number;
}

function optionalText(value) {
  return value === null || value === undefined || String(value).trim() === ''
    ? null
    : String(value).trim();
}

export function createCharacterState() {
  return {
    schemaVersion: CHARACTER_STATE_SCHEMA_VERSION,
    story: {
      schemaVersion: 1,
      time: null,
      place: null,
      ongoingStatuses: [],
      lastConfirmedChange: null,
    },
    inventory: {
      schemaVersion: 1,
      currencies: [],
      items: [],
    },
    wardrobe: {
      schemaVersion: 1,
      garments: [],
      currentOutfit: null,
      savedOutfits: [],
    },
    skills: {
      schemaVersion: 1,
      entries: [],
    },
    cultivation: {
      schemaVersion: 1,
      current: null,
      milestones: [],
      breakthroughs: [],
    },
  };
}

function findByName(items, name) {
  return items.find((item) => item.name === name) ?? null;
}

function eventSummary(event) {
  return {
    schemaVersion: 1,
    eventId: event.eventId,
    batchId: event.batchId,
    kind: event.kind,
    operation: event.operation,
    at: event.createdAt,
  };
}

function eventSource(event) {
  return {
    schemaVersion: 1,
    eventId: event.eventId,
    source: optionalText(event.value?.source) ?? optionalText(event.value?.sourceEvent),
    at: event.createdAt,
  };
}

function applyCurrency(character, event) {
  const value = event.value ?? {};
  const requestedName = text(value.name ?? value.currency, 'currency name');
  const name = /(?:上|中|下|極)品靈石/.test(requestedName)
    ? '靈石'
    : requestedName;
  const existing = findByName(character.inventory.currencies, name);
  const amount = Number(value.amount ?? value.quantity ?? value.value ?? 0);
  let nextAmount;

  if (event.operation === 'add') {
    nextAmount = (existing?.amount ?? 0) + nonNegative(amount, 'currency amount');
  } else if (event.operation === 'subtract') {
    nextAmount = (existing?.amount ?? 0) - nonNegative(amount, 'currency amount');
  } else if (event.operation === 'set') {
    nextAmount = nonNegative(amount, 'currency amount');
  } else {
    return;
  }

  if (nextAmount < 0) {
    throw new TypeError('currency amount cannot be below zero');
  }

  const entry = {
    schemaVersion: 1,
    name,
    amount: nextAmount,
    updatedAt: event.createdAt,
    sourceEventId: event.eventId,
  };
  character.inventory.currencies = existing
    ? character.inventory.currencies.map((item) => (item.name === name ? entry : item))
    : [...character.inventory.currencies, entry];
}

function applyInventory(character, event) {
  const value = event.value ?? {};
  const name = text(value.name, 'item name');
  const existing = findByName(character.inventory.items, name);
  const amount = Number(value.quantity ?? value.amount ?? value.value ?? 0);
  let quantity;

  if (event.operation === 'add') {
    quantity = (existing?.quantity ?? 0) + nonNegative(amount, 'item quantity');
  } else if (event.operation === 'subtract') {
    quantity = (existing?.quantity ?? 0) - nonNegative(amount, 'item quantity');
  } else if (event.operation === 'set') {
    quantity = nonNegative(amount, 'item quantity');
  } else {
    return;
  }

  if (quantity < 0) {
    throw new TypeError('item quantity cannot be below zero');
  }

  const entry = {
    schemaVersion: 1,
    name,
    quantity,
    category: optionalText(value.category) ?? existing?.category ?? 'other',
    source: optionalText(value.source) ?? existing?.source ?? null,
    updatedAt: event.createdAt,
    sourceEventId: event.eventId,
  };
  character.inventory.items = existing
    ? character.inventory.items.map((item) => (item.name === name ? entry : item))
    : [...character.inventory.items, entry];
}

function applyWardrobe(character, event) {
  const value = event.value ?? {};

  if (event.operation === 'wear') {
    const garmentNames = Array.isArray(value.garments)
      ? value.garments.map((item) => String(item?.name ?? item).trim()).filter(Boolean)
      : [];
    const garments = garmentNames.map((name) => findByName(character.wardrobe.garments, name));

    if (garments.length === 0 || garments.some((item) => !item || item.ownershipStatus !== 'owned')) {
      throw new TypeError('only explicitly owned garments can be worn');
    }

    character.wardrobe.currentOutfit = {
      schemaVersion: 1,
      name: optionalText(value.name),
      garmentNames,
      sourceEventId: event.eventId,
      updatedAt: event.createdAt,
    };
    return;
  }

  if (event.operation === 'save_outfit') {
    const name = text(value.name, 'outfit name');
    const garmentNames = Array.isArray(value.garments)
      ? value.garments.map((item) => String(item?.name ?? item).trim()).filter(Boolean)
      : character.wardrobe.currentOutfit?.garmentNames ?? [];
    const outfit = {
      schemaVersion: 1,
      name,
      garmentNames,
      sourceEventId: event.eventId,
      updatedAt: event.createdAt,
    };
    character.wardrobe.savedOutfits = character.wardrobe.savedOutfits.some(
      (item) => item.name === name,
    )
      ? character.wardrobe.savedOutfits.map((item) => (item.name === name ? outfit : item))
      : [...character.wardrobe.savedOutfits, outfit];
    return;
  }

  if (!['add', 'set', 'update'].includes(event.operation)) {
    return;
  }

  const name = text(value.name, 'garment name');
  const ownershipStatus = value.ownershipStatus ?? 'owned';

  if (!OWNERSHIP_STATUSES.has(ownershipStatus)) {
    throw new TypeError('unknown garment ownership status');
  }

  const existing = findByName(character.wardrobe.garments, name);
  const garment = {
    schemaVersion: 1,
    name,
    part: text(value.part ?? existing?.part ?? 'other', 'garment part'),
    description: optionalText(value.description) ?? existing?.description ?? null,
    source: optionalText(value.source) ?? existing?.source ?? null,
    ownershipStatus,
    sourceEventId: event.eventId,
    updatedAt: event.createdAt,
  };
  character.wardrobe.garments = existing
    ? character.wardrobe.garments.map((item) => (item.name === name ? garment : item))
    : [...character.wardrobe.garments, garment];
}

function applySkill(character, event) {
  const value = event.value ?? {};
  const name = text(value.name, 'skill name');
  const existing = findByName(character.skills.entries, name);
  const amount = Number(value.proficiency ?? value.value ?? value.amount ?? 0);
  let proficiency;

  if (event.operation === 'add') {
    proficiency = (existing?.proficiency ?? 0) + nonNegative(amount, 'skill proficiency');
  } else if (event.operation === 'set') {
    proficiency = nonNegative(amount, 'skill proficiency');
  } else {
    return;
  }

  if (existing && proficiency < existing.proficiency) {
    throw new TypeError('skill proficiency cannot automatically decline');
  }

  const entry = {
    schemaVersion: 1,
    name,
    category: optionalText(value.category) ?? existing?.category ?? 'other',
    proficiency,
    sourceEvent: eventSource(event),
    recentChange: eventSummary(event),
    updatedAt: event.createdAt,
  };
  character.skills.entries = existing
    ? character.skills.entries.map((item) => (item.name === name ? entry : item))
    : [...character.skills.entries, entry];
}

function applyCultivation(character, event) {
  if (!['confirm_milestone', 'record_breakthrough', 'set'].includes(event.operation)) {
    return;
  }

  const value = event.value ?? {};
  const stage = text(value.stage ?? value.name, 'cultivation stage');
  const current = {
    schemaVersion: 1,
    stage,
    progressDescription: optionalText(value.progressDescription ?? value.progress),
    sourceEventId: event.eventId,
    updatedAt: event.createdAt,
  };
  character.cultivation.current = current;
  const milestone = {
    schemaVersion: 1,
    name: optionalText(value.milestoneName) ?? stage,
    stage,
    progressDescription: current.progressDescription,
    eventId: event.eventId,
    confirmedAt: event.createdAt,
  };
  character.cultivation.milestones.push(milestone);

  if (event.operation === 'record_breakthrough') {
    character.cultivation.breakthroughs.push({
      ...milestone,
      description: optionalText(value.description),
    });
  }
}

function applyStory(character, event) {
  const value = event.value ?? {};

  if (event.kind === 'story_time') {
    character.story.time = optionalText(value.time ?? value.description ?? value.label) ?? JSON.stringify(value);
  } else if (event.kind === 'place') {
    character.story.place = optionalText(value.name ?? value.place ?? value.description) ?? JSON.stringify(value);
  } else if (event.kind === 'other' && event.operation === 'set_status') {
    const status = text(value.status ?? value.name, 'status');
    character.story.ongoingStatuses = [...new Set([...character.story.ongoingStatuses, status])];
  } else {
    return;
  }

  character.story.lastConfirmedChange = eventSummary(event);
}

export function applyCharacterEvent(character, event) {
  const next = clone(character);

  if (event.kind === 'currency') {
    applyCurrency(next, event);
  } else if (event.kind === 'inventory') {
    applyInventory(next, event);
  } else if (event.kind === 'wardrobe') {
    applyWardrobe(next, event);
  } else if (event.kind === 'skill') {
    applySkill(next, event);
  } else if (event.kind === 'cultivation') {
    applyCultivation(next, event);
  } else {
    applyStory(next, event);
  }

  if (!next.story.lastConfirmedChange && ['currency', 'inventory', 'wardrobe', 'skill', 'cultivation'].includes(event.kind)) {
    next.story.lastConfirmedChange = eventSummary(event);
  }

  return next;
}

export function rebuildCharacterState(events = []) {
  return events
    .filter((event) => event?.deletedAt === null)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .reduce((character, event) => applyCharacterEvent(character, event), createCharacterState());
}

export function actionRequiresPending(state, action) {
  if (action.kind === 'wardrobe') {
    const ownership = action.value?.ownershipStatus;
    return ['gifted', 'borrowed', 'temporary', 'unknown'].includes(ownership);
  }

  if (action.kind === 'cultivation') {
    return true;
  }

  if (action.kind === 'skill') {
    const name = String(action.value?.name ?? '').trim();
    const skill = state.character?.skills?.entries?.find((item) => item.name === name);
    const amount = Number(action.value?.proficiency ?? action.value?.value ?? action.value?.amount ?? 0);
    const target = action.operation === 'add' ? (skill?.proficiency ?? 0) + amount : amount;
    return !skill || !Number.isFinite(target) || Math.abs(target - skill.proficiency) > 5;
  }

  return false;
}

export function createCharacterAction({
  actionId,
  kind,
  operation,
  value,
  dedupeKey,
  timestamp = new Date().toISOString(),
}) {
  return {
    schemaVersion: 1,
    actionId: text(actionId, 'actionId'),
    kind: text(kind, 'kind'),
    operation: text(operation, 'operation'),
    value: clone(value ?? {}),
    dedupeKey: text(dedupeKey, 'dedupeKey'),
    selected: true,
    createdAt: timestamp,
  };
}
