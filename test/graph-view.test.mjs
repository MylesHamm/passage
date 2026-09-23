import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNeighborhood, layoutNeighborhood, EvidenceGraph} from '../dist/graph-view.mjs';
import {filterEvidence,summarizeGraphNode} from '../dist/investigate-model.mjs';

const now=Date.parse('2026-09-22T12:00:00Z');
const node=(id,type,label=id,extra={})=>({id,type,label,...extra});
const report=(id,date='2026-09-21',label=id)=>node(id,'report',label,{publishedAt:date+'T10:00:00Z',record:{publishedAt:date+'T10:00:00Z'}});
const edge=(from,to,relation='MENTIONS')=>({id:from+'|'+relation+'|'+to,from,to,relation,sourceUrl:'https://example.com/evidence/'+from,basis:'Supplied source relationship'});
const ids=view=>new Set(view.nodes.map(item=>item.id));
const byType=view=>Object.fromEntries(['actor','asset','market','channel','event','report'].map(type=>[type,view.nodes.filter(item=>item.type===type).length]));
function assertOriginalConnected(graph,view,selected){
 const visible=ids(view),reached=new Set([selected]);
 for(const connection of view.edges){
  assert.ok(visible.has(connection.from)&&visible.has(connection.to),'a displayed edge must retain both endpoints');
  assert.deepEqual(connection,graph.edges.find(original=>original.id===connection.id),'display selection must preserve the original relationship and provenance');
 }
 let changed=true;
 while(changed){changed=false;for(const connection of view.edges)if(reached.has(connection.from)||reached.has(connection.to))for(const id of [connection.from,connection.to])if(!reached.has(id)){reached.add(id);changed=true;}}
 assert.deepEqual(reached,visible,'every displayed contextual node must have its full evidence path to the selection');
}
function crowdedActorGraph(){
 const reports=Array.from({length:60},(_,i)=>report('report:new-'+i));
 return {
  nodes:[node('actor:a','actor','Selected actor'),...reports,report('report:bridge','2026-09-01','Older export assessment'),
   node('actor:co-mentioned','actor'),node('asset:terminal','asset'),node('channel:exports','channel'),
   node('market:brent','market','Brent daily spot',{record:{observationDate:'2026-09-21'}}),node('market:disconnected','market'),
   node('event:incident','event','Dated source incident',{eventDate:'2026-09-20'}),node('report:register','report','Source register')],
  edges:[...reports.map(item=>edge(item.id,'actor:a')),edge('report:bridge','actor:a'),
   edge('report:bridge','actor:co-mentioned'),edge('report:bridge','asset:terminal'),edge('report:bridge','channel:exports','POTENTIAL_CHANNEL'),
   edge('channel:exports','market:brent','CONTEXT_FOR'),edge('event:incident','actor:a'),edge('report:register','event:incident','REPORTS_EVENT')],
 };
}
test('large source neighborhoods stay bounded while all underlying records remain available',()=>{
 const nodes=[{id:'actor:a',label:'Actor',type:'actor'},...Array.from({length:120},(_,i)=>({id:'report:'+i,label:'Report '+i,type:'report',publishedAt:'2026-09-17T00:00:00Z'}))];
 const edges=nodes.slice(1).map(n=>({id:n.id,from:n.id,to:'actor:a',relation:'MENTIONS'}));
 const graph={nodes,edges},original=structuredClone(graph),selected=selectNeighborhood(graph,'actor:a',{maxNodes:28});
 assert.ok(selected.nodes.length>1&&selected.nodes.length<=5);assert.equal(selected.hidden,121-selected.nodes.length);assert.equal(graph.nodes.length,121);assert.equal(selected.edges.length,selected.nodes.length-1);
 const expanded=selectNeighborhood(graph,'actor:a',{expanded:true,maxNodes:1000});
 assert.ok(expanded.nodes.length<=80);assert.ok(byType(expanded).report<=10);assert.ok(expanded.nodes.length>selected.nodes.length);
 assert.deepEqual(selected,selectNeighborhood(graph,'actor:a',{maxNodes:28}));
 assert.deepEqual(graph,original);assertOriginalConnected(graph,selected,'actor:a');
});
test('broken edges never create invented nodes and an isolated source remains inspectable',()=>{
 const graph={nodes:[{id:'a',type:'report',label:'A'}],edges:[{id:'broken',from:'a',to:'missing'}]};
 const result=selectNeighborhood(graph,'a');assert.equal(result.nodes.length,1);assert.equal(result.edges.length,0);
});
test('repeated headlines reduce initial clutter without deleting distinct source records',()=>{
 const graph={nodes:[{id:'a',type:'actor',label:'Actor'},{id:'r1',type:'report',label:'Oil export update'},{id:'r2',type:'report',label:'Oil export update'}],edges:[edge('r1','a'),edge('r2','a')]};
 const initial=selectNeighborhood(graph,'a');assert.equal(initial.nodes.length,2);assert.equal(initial.repeatedHeadlines,1);assert.equal(graph.nodes.length,3);
 const expanded=selectNeighborhood(graph,'a',{expanded:true});assert.equal(expanded.nodes.length,3);assert.equal(expanded.edges.length,2);
});

test('an older evidence bridge provides diverse actor context despite more than 48 newer reports',()=>{
 const graph=crowdedActorGraph(),original=structuredClone(graph),view=selectNeighborhood(graph,'actor:a'),visible=ids(view),counts=byType(view);
 assert.ok(view.nodes.length<=18);assert.ok(counts.report<=4);
 for(const type of ['actor','asset','market','channel','event','report'])assert.ok(counts[type]>0,type+' should be represented when its evidence path exists');
 for(const id of ['report:bridge','asset:terminal','channel:exports','market:brent','actor:co-mentioned'])assert.ok(visible.has(id),'missing evidence path node '+id);
 assert.ok(!visible.has('market:disconnected'));assertOriginalConnected(graph,view,'actor:a');
 for(const [from,to,relation] of [['report:bridge','actor:a','MENTIONS'],['report:bridge','asset:terminal','MENTIONS'],['report:bridge','channel:exports','POTENTIAL_CHANNEL'],['channel:exports','market:brent','CONTEXT_FOR']])assert.ok(view.edges.some(item=>item.from===from&&item.to===to&&item.relation===relation));
 assert.deepEqual(view.visibleByType,counts);assert.equal(view.availableByType.market,1);assert.ok(view.availableByType.report>=61);
 assert.deepEqual(view,selectNeighborhood(graph,'actor:a'));assert.deepEqual(graph,original);
 const expanded=selectNeighborhood(graph,'actor:a',{expanded:true});assert.ok(expanded.nodes.length<=36);assert.ok(byType(expanded).report<=10);assertOriginalConnected(graph,expanded,'actor:a');
});

test('shared mechanisms, co-mentioned actors and source registers do not pull in unrelated evidence',()=>{
 const graph=crowdedActorGraph();
 graph.nodes.push(report('report:unrelated'),node('actor:unrelated','actor'),node('event:unrelated','event'),report('report:co-actor-only'));
 graph.edges.push(edge('report:unrelated','actor:unrelated'),edge('report:unrelated','channel:exports','POTENTIAL_CHANNEL'),edge('report:register','event:unrelated','REPORTS_EVENT'),edge('event:unrelated','actor:unrelated'),edge('report:co-actor-only','actor:co-mentioned'));
 for(const expanded of [false,true]){
  const view=selectNeighborhood(graph,'actor:a',{expanded}),visible=ids(view);
  for(const id of ['report:unrelated','actor:unrelated','event:unrelated','report:co-actor-only','market:disconnected'])assert.ok(!visible.has(id),'shared context cannot establish the selected actor\'s connection to '+id);
  assert.ok(visible.has('actor:co-mentioned'));assertOriginalConnected(graph,view,'actor:a');
  assert.ok(!view.edges.some(item=>item.from==='actor:a'&&['actor:co-mentioned','market:brent'].includes(item.to)));
  assert.equal(view.availableByType.market,1);assert.equal(view.availableByType.event,1);
 }
});

test('small node budgets keep complete paths instead of orphaning desired legend types',()=>{
 const graph=crowdedActorGraph();
 for(const maxNodes of [1,2,3,4,6]){
  const view=selectNeighborhood(graph,'actor:a',{maxNodes});assert.ok(view.nodes.length<=maxNodes);assert.ok(ids(view).has('actor:a'));assertOriginalConnected(graph,view,'actor:a');
  if(ids(view).has('market:brent'))for(const id of ['report:bridge','channel:exports'])assert.ok(ids(view).has(id));
 }
});

test('duplicate headline grouping preserves a unique evidence bridge and expanded view can reveal every source',()=>{
 const graph={nodes:[node('actor:a','actor'),report('report:new','2026-09-21','Oil export update'),report('report:copy','2026-09-20','Oil export update'),report('report:bridge','2026-09-01','Oil export update'),node('asset:terminal','asset')],edges:[edge('report:new','actor:a'),edge('report:copy','actor:a'),edge('report:bridge','actor:a'),edge('report:bridge','asset:terminal')]};
 const initial=selectNeighborhood(graph,'actor:a'),visible=ids(initial);
 assert.ok(visible.has('asset:terminal'));assert.ok(visible.has('report:bridge'));assert.ok(byType(initial).report<=2);assert.ok(initial.repeatedHeadlines>=1);assertOriginalConnected(graph,initial,'actor:a');
 const expanded=selectNeighborhood(graph,'actor:a',{expanded:true});assert.equal(byType(expanded).report,3);assertOriginalConnected(graph,expanded,'actor:a');
});

test('the selected actor cannot regain contextual nodes after their only evidence bridge is date-filtered out',()=>{
 const graph=crowdedActorGraph(),network=filterEvidence(graph,{days:'7',now}).network;
 assert.ok(network.nodes.some(item=>item.id==='market:brent'),'market context itself remains globally available');
 for(const expanded of [false,true]){
  const view=selectNeighborhood(network,'actor:a',{expanded}),visible=ids(view);
  for(const id of ['report:bridge','actor:co-mentioned','asset:terminal','channel:exports','market:brent'])assert.ok(!visible.has(id),'a removed report cannot support '+id);
  assertOriginalConnected(network,view,'actor:a');assert.equal(view.availableByType.market,0);
 }
 const undated=structuredClone(graph),bridge=undated.nodes.find(item=>item.id==='report:bridge');bridge.publishedAt=null;bridge.record={publishedAt:null,discoveredAt:'2026-08-01T10:00:00Z'};
 const view=selectNeighborhood(filterEvidence(undated,{days:'7',now}).network,'actor:a');assert.ok(ids(view).has('market:brent'));assertOriginalConnected(undated,view,'actor:a');
});

function assertWholeSummary(summary,original){
 assert.equal(summary.fullTitle,original,'the complete source label must remain available without rewriting');
 for(const key of ['title','detail','qualification','fullTitle'])assert.equal(typeof summary[key],'string',key+' must be explicit text');
 assert.doesNotMatch(summary.title,/…|\.\.\./,'a summary must express a topic instead of clipping a headline');
}
test('short source titles remain exact while source provenance belongs in the detail',()=>{
 for(const title of ['Saudi oil export update','Saudi oil exports remain under review by trade experts']){
  assert.ok(title.length<=54);
  const item=node('report:short','report',title,{record:{source:'Reuters',publishedAt:'2026-09-21T10:00:00Z'}}),summary=summarizeGraphNode(item);
  assertWholeSummary(summary,title);assert.equal(summary.title,title);assert.match(summary.detail,/Reuters/);assert.doesNotMatch(summary.title,/Reuters/);
 }
});

test('long reporting labels summarize a topic using an actual connected subject without inventing an event',()=>{
 const title='Officials are reviewing alternative oil export arrangements and shipping capacity through the western terminal as regional conditions change';
 const item=node('report:long','report',title,{record:{source:'Reuters',publishedAt:'2026-09-21T10:00:00Z'}});
 const graph={nodes:[item,node('actor:saudi','actor','Saudi Arabia'),node('asset:yanbu','asset','Yanbu'),node('actor:iran','actor','Iran')],edges:[edge(item.id,'actor:saudi'),edge(item.id,'asset:yanbu')]},original=structuredClone(graph);
 const summary=summarizeGraphNode(item,graph);
 assertWholeSummary(summary,title);assert.ok(summary.title.length<title.length);assert.match(summary.title,/Saudi Arabia|Yanbu/);assert.match(summary.title,/oil exports?|shipping/i);
 assert.doesNotMatch(summary.title,/Iran|attacked|destroyed|caused|halted|closed/i);assert.match(summary.detail,/Reuters/);assert.notEqual(summary.title,summary.detail);
 assert.deepEqual(summary,summarizeGraphNode(item,graph));assert.deepEqual(graph,original);
 const disconnected=summarizeGraphNode(item,{nodes:graph.nodes,edges:[]});assert.doesNotMatch(disconnected.title,/Saudi Arabia|Yanbu|Iran/,'an unrelated graph entity is not a source subject');assertWholeSummary(disconnected,title);
});

test('negation and denial remain visible even when the headline becomes a short topic summary',()=>{
 for(const title of [
  'Iran denies oil terminal attack',
  'Saudi Arabia denies that the western oil export terminal was closed following reports circulated across the region',
  'Saudi Arabia did not close the western terminal used for oil exports despite the reports circulating in overseas markets',
 ]){
  const item=node('report:denial','report',title,{record:{source:'Reuters'}}),summary=summarizeGraphNode(item,{nodes:[item,node('actor:saudi','actor','Saudi Arabia')],edges:[edge(item.id,'actor:saudi')]});
  assertWholeSummary(summary,title);assert.match(summary.title+' '+summary.qualification,/denies|not/i);assert.doesNotMatch(summary.qualification,/Denied claim/);
 }
});

test('conditional and unconfirmed language is preserved as a qualifier rather than strengthened into a fact',()=>{
 for(const cue of ['may','might','could','possible','alleged','unconfirmed']){
  const title=`Saudi Arabia oil exports: ${cue} changes to shipping arrangements remain under review as officials assess the regional outlook`;
  const item=node('report:conditional','report',title,{record:{source:'Doomberg',type:'Independent energy analysis'}}),summary=summarizeGraphNode(item,{nodes:[item,node('actor:saudi','actor','Saudi Arabia')],edges:[edge(item.id,'actor:saudi')]});
  assertWholeSummary(summary,title);assert.ok((summary.title+' '+summary.qualification).includes(cue),cue+' must stay visible');assert.match(summary.detail,/Doomberg/);assert.match(summary.detail,/Independent energy analysis/);
 }
});

test('user notes retain their unverified status and source events retain a source-record qualifier',()=>{
 const manual=node('report:manual','report','My assessment of regional oil exports and the possibility of route changes over the coming weeks',{record:{manual:true,source:'My reading note',summary:'Personal interpretation'}});
 const manualSummary=summarizeGraphNode(manual);assertWholeSummary(manualSummary,manual.label);assert.equal(manualSummary.qualification,'User-supplied · unverified');assert.match(manualSummary.detail,/My reading note/);
 const incident=node('event:record','event','Vessel incident reported in the Red Sea',{eventDate:'2026-09-20',record:{source:'IMO',eventDate:'2026-09-20',evidenceStatus:'Structured source record'}});
 const eventSummary=summarizeGraphNode(incident);assertWholeSummary(eventSummary,incident.label);assert.match(eventSummary.qualification,/source.record/i);assert.match(eventSummary.detail,/IMO/);
});

test('market summaries preserve the daily observation amount, provider and full calendar date',()=>{
 for(const [seriesId,name,value] of [['brent','Brent',74.25],['wti','WTI',69.5]]){
  const item=node('market:'+seriesId,'market',name+' daily spot',{record:{provider:'EIA',seriesId,observationDate:'2026-09-21',value,units:'USD/barrel',basis:'Daily spot observation; not intraday futures'}}),summary=summarizeGraphNode(item);
  assertWholeSummary(summary,item.label);assert.equal(summary.title,`${name} · $${value.toFixed(2)}`);assert.match(summary.detail,/EIA/);assert.match(summary.detail,/2026-09-21/);
  assert.doesNotMatch(summary.detail,/live quote|intraday price|real[- ]time quote/i);
 }
});

test('mechanism summaries preserve the name and explicitly avoid claiming a measured effect',()=>{
 const item=node('channel:supply','channel','Supply disruption',{record:{basis:'Potential channel; effect not measured'}}),summary=summarizeGraphNode(item);
 assertWholeSummary(summary,item.label);assert.equal(summary.title,item.label);assert.equal(summary.detail,'Potential channel · effect not measured');
});


test('compact labels preserve complete claims, attribution, questions and qualifying clauses',()=>{
 const examples=[
  ['How could US-Iran conflict end? Three experts give their views','How could US-Iran conflict end? Three experts give their views'],
  ['Iran must stop arming Houthis in Yemen, G7 says ahead of UN General Assembly','Iran must stop arming Houthis in Yemen, G7 says ahead of UN General Assembly'],
  ['Two sailors missing after tanker attacked in Strait of Hormuz, Oman says','Two sailors missing after tanker attacked in Hormuz, Oman says'],
 ];
 for(const [original,expected] of examples){const summary=summarizeGraphNode(node('r','report',original));assert.equal(summary.title,expected);assert.equal(summary.fullTitle,original);}
 const noOil=summarizeGraphNode(node('r','report','No oil remains in reserve'));
 assert.equal(noOil.title,'No oil remains in reserve');assert.equal(noOil.qualification,'');
 for(const original of [
  'Saudi crude exports stopped — an unverified rumor sends traders scrambling for information',
  'Iran shuts the Strait of Hormuz — a fabricated video spreads across social media and triggers confusion',
  'Oil tankers attacked in the Red Sea — a training simulation demonstrates how rescue crews would respond',
  'Oil terminal destroyed; computer simulation shows a hypothetical emergency',
 ]){
  const summary=summarizeGraphNode(node('r','report',original));
  assert.equal(summary.fullTitle,original);
  if(summary.title.startsWith('Topic:'))assert.doesNotMatch(summary.title,/stopped|shuts|attacked|destroyed/);
  else assert.match(summary.title,/rumor|fabricated|simulation/);
 }
});

test('every selected node receives a complete readable card without label clipping or overlap',()=>{
 const graph=crowdedActorGraph(),view=selectNeighborhood(graph,'actor:a');
 for(const width of [294,480,625,800]){
  const layout=layoutNeighborhood(view.nodes,'actor:a',width,view.edges);
  assert.equal(layout.positions.size,view.nodes.length);
  const cards=[...layout.positions.entries()];
  for(const [id,card] of cards){
   const source=view.nodes.find(item=>item.id===id),summary=summarizeGraphNode(source,view);
   assert.equal(card.lines.join(' ').replaceAll(' ',''),summary.title.replaceAll(' ',''));
   assert.ok(card.lines.length);assert.ok(card.height>=44);assert.ok(card.width>0);
   assert.ok(card.x-card.width/2>=-width/2&&card.x+card.width/2<=width/2);
   assert.ok(card.y-card.height/2>=0&&card.y+card.height/2<=layout.height);
   for(const [otherId,other] of cards)if(id!==otherId)assert.ok(Math.abs(card.x-other.x)>=(card.width+other.width)/2||Math.abs(card.y-other.y)>=(card.height+other.height)/2,'cards overlap: '+id+' '+otherId);
  }
 }
});


test('relationship basis corrections redraw displayed evidence while unchanged layouts keep latest records',()=>{
 const previousDocument=globalThis.document;globalThis.document={activeElement:null};
 try{
  const redraws=[],view={svg:{contains:()=>false},layer:{querySelectorAll:()=>[]},fit(){redraws.push(this.edges[0]?.basis);}};
  const first={nodes:[node('actor:a','actor','Iran'),report('r')],edges:[{...edge('r','actor:a'),basis:'Old attribution'}]};
  EvidenceGraph.prototype.update.call(view,first,'actor:a');
  const corrected={nodes:first.nodes,edges:[{...first.edges[0],basis:'Corrected source attribution'}]};
  EvidenceGraph.prototype.update.call(view,corrected,'actor:a');
  assert.deepEqual(redraws,['Old attribution','Corrected source attribution']);
  const latest={nodes:corrected.nodes.map(item=>({...item,record:{...item.record,firstSeenAt:'2026-09-22T12:00:00Z'}})),edges:corrected.edges.map(item=>({...item,updatedAt:'2026-09-22T12:00:00Z'}))};
  EvidenceGraph.prototype.update.call(view,latest,'actor:a');
  assert.equal(redraws.length,2);assert.equal(view.nodes,latest.nodes);assert.equal(view.edges,latest.edges);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
