import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriorityBrief} from '../dist/priority-brief.mjs';

const NOW=Date.parse('2026-09-28T12:00:00Z');
const report=(id,title,extra={})=>({id,title,url:`https://example.com/${id}`,source:'Example publisher',sourceId:'bbc',publishedAt:'2026-09-28T08:00:00Z',publicationPrecision:'timestamp',contentAccess:'publisher-summary',...extra});
const card=(brief,id)=>brief.cards.find(item=>item.id===id);
const titles=brief=>brief.cards.flatMap(item=>item.items.map(group=>group.title));

test('prioritizes explicit route and oil disruption while excluding unrelated Iran headlines',()=>{
  const brief=buildPriorityBrief({items:[
    report('singer','Iran singer announces a new album',{publishedAt:'2026-09-28T11:59:00Z',theaters:['hormuz'],summary:'Shipping, oil and missile news appear in the site footer.'}),
    report('talks','Iran says ceasefire talks will resume',{publishedAt:'2026-09-28T11:50:00Z'}),
    report('oil','Iran oil exports halted after pipeline damage, operator says',{publishedAt:'2026-09-27T13:00:00Z'}),
    report('tourism','New tourism guide for the Strait of Hormuz'),
    report('culture','Iran talks celebrate regional cinema'),
    report('route','Tankers rerouted as Strait of Hormuz remains closed, shipping firm says'),
  ]},{now:NOW});
  assert.deepEqual(card(brief,'hormuz').items.map(item=>item.report.id),['route','oil','talks']);
  assert.ok(!titles(brief).some(title=>/singer|tourism/.test(title)));
});

test('retains opposing missile and strike claims with qualifiers and no invented responsibility',()=>{
  const houthi=report('houthi','Houthis claim missile launch toward Israel; military says intercepted',{actors:['Houthis','Israel']});
  const israel=report('israel','Israel says it struck Houthi sites in Yemen',{actors:['Houthis','Israel']});
  const brief=buildPriorityBrief({items:[houthi,israel]},{now:NOW});
  assert.deepEqual(new Set(card(brief,'bab').items.map(item=>item.title)),new Set([houthi.title,israel.title]));
  assert.equal(brief.uniqueGroupCount,2);
  assert.ok(card(brief,'bab').items.every(item=>item.independentConfirmation===false));
  assert.equal(card(brief,'hormuz').items.length,0);
});

test('cross-listed headline is one unique group, even when both theatres are named',()=>{
  const brief=buildPriorityBrief({items:[report('both','Missile alerts issued for Red Sea and Strait of Hormuz shipping')]},{now:NOW});
  assert.equal(card(brief,'bab').items.length,1);
  assert.equal(card(brief,'hormuz').items.length,1);
  assert.equal(brief.uniqueGroupCount,1);
  assert.equal(card(brief,'bab').items[0].id,card(brief,'hormuz').items[0].id);
});

test('39 matching headlines collapse without adding corroboration or ranking weight',()=>{
  const headline='Iran must stop arming Houthis in Yemen, G7 says';
  const copies=Array.from({length:39},(_,i)=>report(`copy-${i}`,i%2?'Iran must stop arming Houthis in Yemen , G7 says':headline,{publishedAt:null,publicationPrecision:'unknown',discoveredAt:'2026-09-28T11:00:00Z',sourceId:'gdelt-redsea',contentAccess:'discovery-metadata',source:`Outlet ${i}`,provenance:[{sourceId:'gdelt-redsea',url:`https://example.com/copy-${i}`}]}));
  const strike=report('strike','Houthis claim attack on Red Sea tanker');
  const single=buildPriorityBrief({items:[copies[0],strike]},{now:NOW});
  const many=buildPriorityBrief({items:[...copies,strike]},{now:NOW});
  assert.deepEqual(card(single,'bab').items.map(item=>item.title),card(many,'bab').items.map(item=>item.title));
  const group=card(many,'bab').items.find(item=>item.copies.length===39);
  assert.equal(group.sourceUrls.length,39);
  assert.equal(group.repeatedHeadline,true);
  assert.equal(group.independentConfirmation,false);
  assert.deepEqual(group.copies[0].provenance,copies[0].provenance);
  assert.equal(many.uniqueGroupCount,2);
});

test('discovery clock never becomes publication and direct publisher metadata wins equal importance',()=>{
  const discovery=report('discovery','Houthis report missile launch toward Israel',{publishedAt:null,publicationPrecision:'unknown',discoveredAt:'2026-09-28T11:55:00Z',sourceId:'gdelt-redsea',dateBasis:'discovery',contentAccess:'discovery-metadata'});
  const direct=report('publisher','Israel reports strike on Houthi positions in Yemen',{publishedAt:'2026-09-28T08:00:00Z'});
  const brief=buildPriorityBrief({items:[discovery,direct]},{now:NOW});
  assert.equal(card(brief,'bab').items[0].report.id,'publisher');
  const item=card(brief,'bab').items.find(item=>item.report.id==='discovery');
  assert.equal(item.clock.kind,'discovery');
  assert.equal(item.clock.value,discovery.discoveredAt);
  assert.match(item.clock.label,/publication unknown/i);
  assert.equal(item.report.publishedAt,null);
  assert.equal(item.report.dateBasis,'discovery');
});

test('a direct publisher copy supplies the display headline but preserves every original copy',()=>{
  const direct=report('publisher','Houthis claim attack on Red Sea tanker');
  const discovery=report('copy',direct.title,{publishedAt:null,publicationPrecision:'unknown',discoveredAt:'2026-09-28T11:00:00Z',sourceId:'gdelt-redsea',contentAccess:'discovery-metadata'});
  const brief=buildPriorityBrief({items:[discovery,direct]},{now:NOW});
  const item=card(brief,'bab').items[0];
  assert.equal(item.url,direct.url);
  assert.equal(item.clock.kind,'publication');
  assert.equal(item.copies.length,2);
  assert.ok(item.copies.includes(discovery));
});

test('window excludes old, future and unknown clocks; a new snapshot changes the selection',()=>{
  const rows=[
    report('old','Iran oil exports suspended',{publishedAt:'2026-09-25T11:59:59Z',discoveredAt:'2026-09-28T11:00:00Z'}),
    report('future','Iran tanker incident reported',{publishedAt:'2026-09-28T12:00:01Z'}),
    report('unknown','Iran tanker incident reported',{publishedAt:null,firstSeenAt:'2026-09-28T11:00:00Z'}),
    report('invalid','Iran tanker incident reported',{publishedAt:'2026-02-30T12:00:00Z'}),
    report('boundary','Iran oil exports resume',{publishedAt:'2026-09-25T12:00:00Z'}),
  ];
  const old=buildPriorityBrief({items:rows},{now:NOW});
  assert.deepEqual(card(old,'hormuz').items.map(item=>item.report.id),['boundary']);
  const next=buildPriorityBrief({items:[...rows,report('new','Iran says tanker seized near Hormuz',{publishedAt:'2026-09-28T12:01:00Z'})]},{now:NOW+120000});
  assert.deepEqual(card(next,'hormuz').items.map(item=>item.report.id),['new','future']);
  assert.equal(card(old,'hormuz').items[0].report.id,'boundary');
});

test('regional exports and market headlines have their own context card without invented theatre locations',()=>{
  const brief=buildPriorityBrief({items:[report('export','Saudi oil exports halted after pipeline damage'),report('market','Brent oil prices rise as traders assess supply outlook'),report('food','Saudi palm oil exports rise')]},{now:NOW});
  assert.deepEqual(card(brief,'energy').items.map(item=>item.report.id),['export','market']);
  assert.equal(card(brief,'hormuz').items.length,0);
  assert.equal(card(brief,'bab').items.length,0);
});

test('respects actor and theatre filters and caps four groups per card',()=>{
  const rows=Array.from({length:7},(_,i)=>report(`h-${i}`,`Iran oil export terminal ${i} reports outage`,{actors:['Iran']}));
  rows.push(report('bab','Houthis claim attack on Red Sea vessel',{actors:['Houthis']}));
  const brief=buildPriorityBrief({items:rows},{now:NOW,theater:'hormuz',actor:'Iran'});
  assert.equal(brief.cards.length,1);
  assert.equal(card(brief,'hormuz').items.length,4);
  assert.equal(card(brief,'hormuz').groupCount,7);
  assert.equal(brief.uniqueGroupCount,4);
  assert.equal(buildPriorityBrief({items:rows},{now:NOW,actor:'Houthis'}).uniqueGroupCount,1);
});

test('safe empty states and malformed records do not create clear-water claims',()=>{
  for(const input of [undefined,null,{}, {items:null}, {items:[null,{},report('unsafe','Iran oil exports halt',{url:'javascript:alert(1)'}),report('bad-date','Iran oil exports halt',{publicationPrecision:'day',publishedAt:123})]}]){
    const brief=buildPriorityBrief(input,{now:NOW});
    assert.deepEqual(brief.cards.map(item=>item.id),['hormuz','bab']);
    assert.equal(brief.uniqueGroupCount,0);
    assert.ok(brief.cards.every(item=>item.items.length===0));
    assert.match(brief.scopeNote,/not a complete|not complete/i);
  }
});

test('Unicode punctuation folding retains accents, original links and publication-day precision',()=>{
  const original=report('unicode','Iran oil exports halted at Café terminal—operator says',{publishedAt:null,publishedDate:'2026-09-28',publicationPrecision:'day',url:'https://example.com/original?utm_source=feed'});
  const copy=report('unicode-copy','Iran oil exports halted at Café terminal / operator says');
  const distinct=report('distinct','Iran oil exports resume at Café terminal, operator says');
  const brief=buildPriorityBrief({items:[original,copy,distinct]},{now:NOW});
  const group=card(brief,'hormuz').items.find(item=>item.copies.length===2);
  assert.equal(brief.uniqueGroupCount,2);
  assert.ok(group.sourceUrls.includes(original.url));
  assert.equal(group.copies.find(item=>item.id==='unicode').publishedAt,null);
  const dayOnly=buildPriorityBrief({items:[original]},{now:NOW});
  assert.equal(card(dayOnly,'hormuz').items[0].clock.precision,'day');
  assert.equal(card(dayOnly,'hormuz').items[0].clock.value,'2026-09-28');
});

test('same publisher URL repeated by metadata families is one source link and does not multiply groups',()=>{
  const original=report('one','Iran oil exports halted, operator says');
  const copy={...original,sourceId:'gdelt-exports',contentAccess:'discovery-metadata'};
  const brief=buildPriorityBrief({items:[original,copy]},{now:NOW});
  const group=card(brief,'hormuz').items[0];
  assert.equal(group.sourceUrls.length,1);
  assert.equal(group.copies.length,2);
  assert.equal(group.repeatedHeadline,false);
  assert.equal(brief.uniqueGroupCount,1);
});

test('Revolutionary Guard aliases and scoped naval or military exercises reach the Hormuz brief',()=>{
  for(const title of [
    'Revolutionary Guards claim drone attack',
    'Revolutionary Guard claims missile attack',
    'Islamic Revolutionary Guard Corps reports drone interception',
    'IRGC announces naval drills',
    'Tehran announces military exercises',
    'Iran announces a naval exercise',
    'IRGC announces a military drill',
  ]){
    const row=report('security',title);
    const brief=buildPriorityBrief({items:[row]},{now:NOW});
    assert.equal(card(brief,'hormuz').items[0]?.title,title);
    assert.equal(card(brief,'bab').items.length,0);
    assert.equal(brief.uniqueGroupCount,1);
  }
});

test('unrelated exercises, drills and unscoped naval reporting stay out of the brief',()=>{
  const brief=buildPriorityBrief({items:[
    report('school','Iran schools hold fire drills'),
    report('fitness','IRGC recruits share fitness exercises'),
    report('concert','Revolutionary Guards host musical concert'),
    report('unscoped','Naval exercises begin in the Baltic Sea'),
    report('summary','Tehran hosts international gathering',{summary:'Military exercises discussed elsewhere on the site.'}),
  ]},{now:NOW});
  assert.equal(brief.uniqueGroupCount,0);
  assert.ok(brief.cards.every(item=>item.items.length===0));
});

test('oil exports and petroleum market headlines rank ahead of general military claims',()=>{
  const airbase=report('airbase','Iran denies link to attack on UK airbase',{publishedAt:'2026-09-28T11:55:00Z'});
  const exports=report('exports','Iraq looks for oil export alternatives to troubled Hormuz',{publishedAt:'2026-09-28T08:00:00Z'});
  const market=report('market','Oil prices surge after Trump rejects Iran plan to reopen Hormuz',{publishedAt:'2026-09-28T07:00:00Z'});
  const shipping=report('shipping','Shipping halted in Hormuz, operator says',{publishedAt:'2026-09-27T15:00:00Z'});
  const bab=report('bab-strike','Israel says it struck Houthi sites in Yemen');
  const brief=buildPriorityBrief({items:[airbase,exports,market,shipping,bab]},{now:NOW});
  assert.deepEqual(card(brief,'hormuz').items.map(item=>item.report.id),['shipping','exports','market','airbase']);
  assert.equal(card(brief,'hormuz').items.find(item=>item.report.id==='market').title,market.title);
  assert.equal(card(brief,'bab').items[0].title,bab.title);
});

test('matching headlines on different known publication days stay distinct and unknown dates never bridge them',()=>{
  const title='Houthis claim missile attack on Red Sea tanker';
  const older=report('older',title,{publishedAt:'2026-09-26T10:00:00Z'});
  const newer=report('newer',title,{publishedAt:'2026-09-28T08:00:00Z'});
  const unknown=report('unknown',title,{publishedAt:null,publicationPrecision:'unknown',discoveredAt:'2026-09-28T11:00:00Z',sourceId:'gdelt-redsea',contentAccess:'discovery-metadata'});
  const anotherUnknown={...unknown,id:'other-unknown',url:'https://example.com/other-unknown'};
  const items=[older,newer,unknown,anotherUnknown];
  const brief=buildPriorityBrief({items},{now:NOW});
  const groups=card(brief,'bab').items;
  assert.equal(groups.length,3);
  assert.equal(new Set(groups.map(item=>item.id)).size,3);
  assert.deepEqual(groups.map(item=>item.copies.map(copy=>copy.id)),[['newer'],['older'],['other-unknown','unknown']]);
  assert.equal(groups.find(item=>item.report.id==='unknown'||item.report.id==='other-unknown').clock.kind,'discovery');
  const reordered=buildPriorityBrief({items:[...items].reverse()},{now:NOW});
  assert.deepEqual(card(reordered,'bab').items.map(item=>item.id),groups.map(item=>item.id));
});

test('an unknown-publication copy joins a matching headline only when one publication day is known',()=>{
  const title='Iran oil exports halted, operator says';
  const known=report('known',title,{publishedAt:null,publishedDate:'2026-09-27',publicationPrecision:'day'});
  const unknown=report('unknown',title,{publishedAt:null,publicationPrecision:'unknown',discoveredAt:'2026-09-28T11:00:00Z',sourceId:'gdelt-exports',contentAccess:'discovery-metadata'});
  const brief=buildPriorityBrief({items:[unknown,known]},{now:NOW});
  const group=card(brief,'hormuz').items[0];
  assert.equal(brief.uniqueGroupCount,1);
  assert.equal(group.copies.length,2);
  assert.equal(group.clock.kind,'publication');
  assert.equal(group.report.publishedDate,'2026-09-27');
  assert.equal(group.copies.find(item=>item.id==='unknown').publishedAt,null);
});

test('explicit forces targeting or military movement remains visible without matching generic targets',()=>{
  const title='Yemeni government forces target Houthi buildup in new preemptive strategy';
  const brief=buildPriorityBrief({items:[
    report('arab-news',title,{source:'Arab News',sourceId:'arab-news'}),
    report('mobilize','Yemeni government forces mobilize near Aden'),
    report('advance','Iran military advances toward border'),
    report('sport','Iran football team targets championship final'),
    report('culture','Yemeni singer targets international audience'),
    report('buildup','Iran festival buildup attracts visitors'),
    report('strategy','Houthi cultural group announces new preemptive strategy'),
  ]},{now:NOW});
  assert.deepEqual(new Set(card(brief,'bab').items.map(item=>item.report.id)),new Set(['arab-news','mobilize']));
  assert.deepEqual(card(brief,'hormuz').items.map(item=>item.report.id),['advance']);
  assert.equal(card(brief,'bab').items.find(item=>item.report.id==='arab-news').title,title);
  assert.equal(brief.uniqueGroupCount,3);
});

test('recent Yemen mobilization, conflict casualties and mediation reach Bab without invented oil effects',()=>{
  const rows=[
    report('mobilisation',"Yemen's president calls on his people to mobilise against Iran-backed Houthis",{source:'France 24 Middle East',sourceId:'france24',publishedAt:'2026-09-25T20:41:00Z'}),
    report('casualties','Yemen casualties rising by around 100 per day amid escalating conflict: WHO',{source:'Middle East Monitor',sourceId:'memo',publishedAt:'2026-09-28T09:30:00Z'}),
    report('backing','Sudanese army chief backs Yemen’s government forces against Houthis',{source:'Middle East Monitor',sourceId:'memo',publishedAt:'2026-09-28T09:00:00Z'}),
    report('mediation','Hamas says it offered mediation in Yemen, awaits response from warring sides',{source:'Middle East Monitor',sourceId:'memo',publishedAt:'2026-09-27T08:00:00Z'}),
  ];
  const brief=buildPriorityBrief({items:rows},{now:NOW});
  assert.equal(card(brief,'bab').items.length,4);
  for(const row of rows){
    const selected=card(brief,'bab').items.find(item=>item.report.id===row.id);
    assert.equal(selected.title,row.title);assert.equal(selected.clock.value,row.publishedAt);assert.equal(selected.report,row);assert.equal(selected.independentConfirmation,false);
    assert.equal(selected.category,['mobilisation','casualties'].includes(row.id)?'Military & security':'Conflict policy');
    assert.equal(selected.report.eventDate,undefined);assert.equal(selected.report.oilImpact,undefined);
  }
  assert.equal(card(brief,'energy'),undefined);
});

test('civil mobilization, sports metaphors and casualties without conflict stay out of military selection',()=>{
  const rows=[
    report('peaceful','Yemen activists mobilise for peaceful protest against Houthis'),
    report('supporters','Houthis mobilise supporters for peaceful demonstration'),
    report('sports','Iran army football team mobilises fans for championship'),
    report('sports-support','Yemen president backs army football team'),
    report('civil-support','Houthi leader backs local education reforms'),
    report('school-mediation','Yemen teachers offer mediation in school wage dispute'),
    report('civil-dispute','Yemen community mediator settles land dispute'),
    report('road','Yemen casualties rising after bus accident'),
    report('health','Yemen death toll rises amid cholera outbreak'),
    report('sports-casualties','Iran football casualties mount amid conflict between rival teams'),
    report('summary-only','Yemen president speaks to supporters',{summary:'The president urged mobilization against Houthis; elsewhere there are casualties from fighting.'}),
  ];
  const brief=buildPriorityBrief({items:rows},{now:NOW});
  assert.equal(brief.uniqueGroupCount,0);
});
