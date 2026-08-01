import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHandoffSections } from '../src/core/snapshot-handoff.js';
test('canonical handoff reads only current player snapshot sections', () => {
 const snapshot={playerEntityId:'entity:player',currentTime:'申時',currentPlace:'書房',assets:[{current:true,ownerEntityId:'entity:player',canonicalName:'糕點',quantity:{text:'一些'},container:{type:'carried'},ownership:'borrowed'},{current:true,ownerEntityId:'entity:player',canonicalName:'冬衣',quantity:{exact:1,unit:'件'},container:{type:'room',display:'箱子'},ownership:'owned'},{current:true,ownerEntityId:'entity:npc',canonicalName:'NPC物',quantity:{exact:1},container:{type:'carried'}}],currencies:[],entities:{'entity:npc':{canonicalName:'墨錚',durableStatuses:[{state:'active',label:'受傷'},{state:'resolved',label:'痊癒'}]}},relationships:{}};
 const sections=canonicalHandoffSections(snapshot); const text=sections.map((x)=>x[1]).join('\n'); assert.match(text,/一些/); assert.match(text,/借用/); assert.match(text,/不在玩家身上/); assert.doesNotMatch(text,/NPC物|痊癒|eventId|add/); assert.deepEqual(sections,canonicalHandoffSections(snapshot));
});
