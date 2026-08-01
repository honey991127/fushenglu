export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function quantityText(quantity = {}) {
  if (Number.isFinite(quantity.exact)) return `${quantity.exact}${quantity.unit ?? ''}`;
  return quantity.text || '數量未記錄';
}

export function ownershipText(ownership) {
  return ({ owned: '永久擁有', gifted: '獲贈', purchased: '購得', borrowed: '借用', temporary: '暫時持有', custody: '代為保管', stored: '存放', unknown: '所有權未確認' })[ownership] ?? '所有權未確認';
}

export function containerText(container = {}) {
  const label = ({ carried: '隨身攜帶', sleeve: '袖中', inventory: '行囊', storage_space: '儲物空間', room: '存放於房間', other: '其他位置' })[container.type] ?? '存放位置未記錄';
  return container.display ? `${label}（${container.display}）` : label;
}

const kindLabels = { story_time: '故事時間', place: '地點', inventory: '物品', currency: '貨幣', person_state: '人物狀態', relationship: '人物關係' };
export function formatReviewItem(item) {
  const value = item?.value ?? item?.proposal?.value ?? {};
  const subject = item?.subjectRef?.rawName || value.subjectName || value.name || (item?.subjectEntityId === 'entity:player' ? '玩家' : '此人物');
  if (item.kind === 'story_time') return { title: '故事時間', text: value.time || value.canonicalDisplay || '更新故事時間' };
  if (item.kind === 'place') return { title: item.subjectEntityId && item.subjectEntityId !== 'entity:player' ? '人物位置' : '玩家抵達', text: `${subject}：${value.name || value.place || '地點未記錄'}` };
  if (item.kind === 'inventory') {
    const name = value.displayName || value.canonicalName || value.name || '未命名物品';
    const operation = ({ acquire: '獲得物品', add: '獲得物品', consume: '使用物品', subtract: '使用物品', move: '移動物品', transfer: '轉交物品', return: '歸還物品', destroy: '銷毀物品', lose: '失去物品', discard: '丟棄物品' })[item.operation] || '物品變化';
    return { title: operation, text: `${name} · ${quantityText(value.quantity ?? value)} · ${ownershipText(value.ownership)} · ${containerText(value.container)}` };
  }
  if (item.kind === 'currency') return { title: '貨幣', text: `${value.name || value.currency || '未命名貨幣'} ${quantityText(value.quantity ?? { exact: value.amount, unit: value.unit })}${value.tier ? ` · ${value.tier}` : ''} · ${containerText(value.container)}` };
  if (item.kind === 'person_state') return { title: '人物狀態', text: `${subject}：${value.status || '狀態更新'}` };
  if (item.kind === 'relationship') return { title: '人物關係', text: `${subject} → ${value.targetName || value.targetEntityId || '對方'}：${value.formalStatus || value.relationship || value.trend || '關係更新'}` };
  return { title: kindLabels[item.kind] || '其他變化', text: '已辨識一項可安全確認的變化' };
}

export function safeReviewItems(batch) { return [...(batch?.detectedChanges ?? [])].filter((item) => (item.policyDisposition ?? item.reviewDisposition ?? 'apply') === 'apply'); }
export function reviewSummary(batch) { const items = safeReviewItems(batch); const counts = { time: 0, place: 0, inventory: 0, person: 0, relationship: 0, other: 0 }; for (const item of items) { if (item.kind === 'story_time') counts.time++; else if (item.kind === 'place') counts.place++; else if (['inventory', 'currency'].includes(item.kind)) counts.inventory++; else if (item.kind === 'person_state') counts.person++; else if (item.kind === 'relationship') counts.relationship++; else counts.other++; } return { items, counts, total: items.length }; }
export function pendingQuestion(item) { const v = item?.proposal?.value ?? item?.value ?? {}; const name = v.name || v.canonicalName || '此資料'; const kind = item?.reasonCode || item?.kind; if (kind === 'ownership') return `「${name}」是永久送給玩家，還是只讓玩家查看？`; if (kind === 'quantity_calculation') return `目前只知道玩家有「${name}」，無法精確計算剩餘數量。`; if (kind === 'identity') return `「${name}」對應哪一位人物？`; if (kind === 'conflict') return `「${name}」與已確認資料不一致，請選擇處理方式。`; return `這項資料的主線情境尚未確認：${name}`; }
export function pendingOptions(item) { const kind = item?.reasonCode || item?.kind; if (kind === 'ownership') return [['accepted','永久收下'], ['edited','借用／暫時保管'], ['rejected','沒有取得']]; if (kind === 'quantity_calculation') return [['accepted','保留模糊剩餘量'], ['edited','設定目前數量'], ['rejected','視為全部用完']]; return [['accepted','確認'], ['rejected','不採用']]; }
export function shortEvidence(item) { const quote = item?.proposal?.evidence?.quote ?? item?.evidence?.quote ?? ''; return String(quote).trim().slice(0, 180); }
export function homeModel(state) { const s = state?.currentSnapshot ?? {}; const player = s.playerEntityId ?? 'entity:player'; const assets = (s.assets ?? []).filter((x) => x.current && x.ownerEntityId === player); const carried = assets.filter((x) => ['carried','sleeve','inventory'].includes(x.container?.type)); const stored = assets.filter((x) => !['carried','sleeve','inventory'].includes(x.container?.type)); const currencies = (s.currencies ?? []).filter((x) => x.current && x.ownerEntityId === player); const statuses = Object.values(s.entities ?? {}).flatMap((e) => (e.durableStatuses ?? []).filter((d) => d.state === 'active').map((d) => `${e.canonicalName || e.entityId}：${d.label}`)); const pending = (state?.pendingItems ?? []).filter((x) => x.status === 'pending').length; const batch = [...(state?.batches ?? [])].reverse().find((b) => b.status === 'review_ready'); return { time: s.currentTime, place: s.currentPlace, carried, stored, currencies, statuses, pending, review: reviewSummary(batch) }; }
