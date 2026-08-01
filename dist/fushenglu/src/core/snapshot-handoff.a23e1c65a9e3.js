function q(value = {}) { return Number.isFinite(value.exact) ? `${value.exact}${value.unit ?? ''}` : value.text || '數量未記錄'; }
function own(value) { return ({ borrowed: '借用', temporary: '暫時持有', custody: '代為保管' })[value] || ''; }
export function canonicalHandoffSections(snapshot = {}) {
  const player = snapshot.playerEntityId ?? 'entity:player'; const assets = (snapshot.assets ?? []).filter((x) => x.current && x.ownerEntityId === player);
  const carried = assets.filter((x) => ['carried','sleeve','inventory'].includes(x.container?.type)).map((x) => `${x.displayName || x.canonicalName}（${q(x.quantity)}${own(x.ownership) ? `，${own(x.ownership)}` : ''}）`);
  const stored = assets.filter((x) => !['carried','sleeve','inventory'].includes(x.container?.type)).map((x) => `${x.displayName || x.canonicalName}存放於${x.container?.display || '其他位置'}，不在玩家身上。`);
  const currencies = (snapshot.currencies ?? []).filter((x) => x.current && x.ownerEntityId === player).map((x) => `${x.name} ${x.amount}${x.unit ?? ''}${x.tier ? `（${x.tier}）` : ''}`);
  const statuses = Object.values(snapshot.entities ?? {}).flatMap((e) => (e.durableStatuses ?? []).filter((s) => s.state === 'active').map((s) => `${e.canonicalName || e.entityId}目前${s.label}。`));
  const relationships = Object.values(snapshot.relationships ?? {}).filter((r) => !/[0-9]/.test(String(r.trend ?? r.formalStatus ?? ''))).map((r) => `${r.fromEntityId}對${r.toEntityId}的${r.formalStatus || r.dimension}${r.trend && r.trend !== 'unknown' ? `：${r.trend}` : ''}。`);
  return [ ['current_time', snapshot.currentTime ? `目前時間：${snapshot.currentTime}。` : null], ['current_place', snapshot.currentPlace ? `玩家目前在${snapshot.currentPlace}。` : null], ['player_carried_assets', carried.length ? `玩家隨身持有${carried.join('、')}。` : null], ['player_stored_assets', stored.join(' ') || null], ['player_currencies', currencies.length ? `玩家目前貨幣：${currencies.join('、')}。` : null], ['durable_statuses', statuses.join(' ') || null], ['relationships', relationships.join(' ') || null] ].filter(([, text]) => text);
}
