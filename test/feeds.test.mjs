import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEIA, parseRSS, classify, safeUrl, freshness, reportRelevant, publisherSummary, SOURCES, classifyReport } from '../lib/feeds.mjs';

test('daily prices preserve missing days and cross-month dates',()=>{
  const html="<tr><td class='B6'>2026 Aug-31 to Sep- 4</td><td class='B3'></td><td class='B3'>96.02</td><td class='B3'>97.59</td><td class='B3'>NA</td><td class='B3'>102.24</td></tr>Release Date: 9/10/2026";
  const actual=parseEIA(html,Date.parse('2026-09-11T00:00:00Z'));
  assert.deepEqual(actual.observations,[{date:'2026-09-01',value:96.02},{date:'2026-09-02',value:97.59},{date:'2026-09-04',value:102.24}]);
  assert.equal(actual.releaseDate,'9/10/2026');
});
test('changed price markup fails instead of fabricating zero values',()=>{
  assert.throws(()=>parseEIA('<html>Service unavailable</html>'),/format changed/);
});
test('future price observations are excluded',()=>{
  const data=parseEIA("<tr><td class='B6'>2026 Sep- 7 to Sep-11</td><td class='B3'>50</td><td class='B3'>51</td></tr>",Date.parse('2026-09-07T00:00:00Z'));
  assert.deepEqual(data.observations,[{date:'2026-09-07',value:50}]);
});
test('RSS preserves source identity and attribution, rejects bad dates and unsafe URLs',()=>{
  const source={id:'test',name:'Test source',type:'Official statement'};
  const item=(title,url,date)=>`<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${date}</pubDate><description>Iran and civilian crews</description></item>`;
  const xml='<rss><channel>'+item('Houthis &amp; Red Sea','https://example.com/story?a=1&amp;b=2','Fri, 11 Sep 2026 10:00:00 GMT')+item('Bad','javascript:alert(1)','Fri, 11 Sep 2026 10:00:00 GMT')+item('Bad date','https://example.com/b','invalid')+item('Future','https://example.com/f','Fri, 11 Sep 2037 10:00:00 GMT')+'</channel></rss>';
  const rows=parseRSS(xml,source,Date.parse('2026-09-11T12:00:00Z'));
  assert.equal(rows.length,1);assert.equal(rows[0].title,'Houthis & Red Sea');assert.equal(rows[0].type,'Official statement');assert.equal(rows[0].url,'https://example.com/story?a=1&b=2');assert.deepEqual(rows[0].theaters,['bab']);assert.ok(rows[0].actors.includes('Civilians'));
});
test('upstream HTML errors do not count as empty successful RSS responses',()=>{assert.throws(()=>parseRSS('<html>Blocked</html>',{}),/Unexpected feed/);});
test('security tags and energy tags identify text mentions without constructing events',()=>{
  assert.equal(reportRelevant(classify('A gardening story')),false);
  const d=classify('CENTCOM says U.S. Navy escorts a tanker near Hormuz');assert.ok(d.actors.includes('U.S. military'));assert.equal(d.energy,true);assert.deepEqual(d.theaters,['hormuz']);
});
test('edible oil prices alone do not count as petroleum market reporting',()=>{
  const unrelated=classify('Crude palm oil prices to remain above $1,154 per ton');
  assert.equal(reportRelevant(unrelated),false);assert.equal(unrelated.energy,false);
  assert.equal(reportRelevant(classify('Brent rise affects palm oil prices')),true);
  assert.equal(reportRelevant(classify('Hormuz disruption raises food and palm oil prices')),true);
});
test('theatre geography comes from the headline, not unrelated feed-description links',()=>{
  const d=classify('Guyana oil boom and challenges Iran explainer','Guyana oil boom and challenges');
  assert.deepEqual(d.theaters,[]);assert.equal(d.energy,true);
});
test('regional actors stay separately filterable',()=>{
  const d=classify('Saudi Aramco pipeline and IRGC tanker near Fujairah');
  assert.ok(d.actors.includes('Saudi Arabia'));assert.ok(d.actors.includes('IRGC'));assert.ok(d.actors.includes('UAE'));
});
test('source freshness uses publication time, not request success',()=>{const now=Date.parse('2026-09-11T00:00:00Z');assert.equal(freshness('2026-02-05',now),'stale');assert.equal(freshness('2026-09-10',now),'current');assert.equal(freshness(null,now),'unknown');assert.equal(safeUrl('data:text/html,test'),null);});

test('Saudi infrastructure and oil markets remain relevant without fabricated theater locations',()=>{
  for(const headline of ['Saudi Arabia shuts East-West pipeline after attack','Oman offers additional crude cargoes','Brent falls as oil supply concerns ease','Saudi-US talks address regional ceasefire']) {
    const row=classify(headline);assert.equal(reportRelevant(row),true,headline);assert.deepEqual(row.theaters,[]);assert.ok(row.relevanceScopes.length);
  }
  assert.equal(reportRelevant(classify('Saudi Arabia opens art exhibition')),false);
  assert.equal(reportRelevant(classify('Guyana oil boom and challenges Iran explainer','Guyana oil boom and challenges')),false);
});
test('publication absence stays unknown and publisher summaries retain matched-field provenance',()=>{
  const xml='<rss><channel><item><title>Saudi export pipeline update</title><link>https://example.com/pipeline</link><description><![CDATA[<p>Aramco says crude shipments changed.</p><p>Read more: Iran football and other stories</p>]]></description></item></channel></rss>';
  const [row]=parseRSS(xml,{id:'test',name:'Test',type:'Reporting'},Date.parse('2026-09-17T12:00:00Z'));
  assert.equal(row.publishedAt,null);assert.equal(row.dateBasis,'publication-unknown');assert.equal(row.summary,'Aramco says crude shipments changed.');
  assert.ok(row.matchEvidence.some(x=>x.field==='summary'&&x.kind==='actor'&&x.value==='Saudi Arabia'));assert.ok(!row.actors.includes('Iran'));
  assert.equal(row.contentAccess,'publisher-summary');assert.ok(publisherSummary('x'.repeat(400)).length<=280);
});
test('public source URLs cannot expose userinfo or common secret parameters',()=>{
  for(const url of ['https://alice:secret@example.com/a','https://example.com/?api_key=secret','https://example.com/?access_token=secret','http://127.0.0.1/private','https://localhost/foo'])assert.equal(safeUrl(url),null,url);
});
test('publisher calendar dates cannot roll into another month before validation',()=>{
  const source={id:'test',name:'Test',type:'Reporting'},now=Date.parse('2026-09-21T12:00:00Z');
  const parse=date=>parseRSS(`<rss><channel><item><title>Saudi oil exports</title><link>https://example.com/article</link><pubDate>${date}</pubDate></item></channel></rss>`,source,now);
  for(const date of ['Mon, 30 Feb 2026 10:00:00 GMT','2026-02-30T10:00:00Z','Sun, 29 Feb 2026 10:00:00 +0300','Thu, 31 Apr 2026 10:00:00 GMT'])assert.equal(parse(date).length,0,date);
  for(const [date,expected] of [
    ['Thu, 29 Feb 2024 10:00:00 GMT','2024-02-29T10:00:00.000Z'],
    ['Fri, 11 Sep 2026 10:00:00 +0300','2026-09-11T07:00:00.000Z'],
    ['11 Sep 2026 10:00 GMT','2026-09-11T10:00:00.000Z'],
    ['Fri, 11 Sep 26 10:00:00 GMT','2026-09-11T10:00:00.000Z'],
    ['2026-02-28T23:30:00-04:00','2026-03-01T03:30:00.000Z'],
  ])assert.equal(parse(date)[0]?.publishedAt,expected,date);
});
test('Doomberg keeps only bounded public preview text and dates with an analysis label',()=>{
 const source=SOURCES.find(s=>s.id==='doomberg');
 const xml=`<rss><channel><item><title>A changing balance</title><link>https://newsletter.doomberg.com/p/example?utm_source=rss</link><pubDate>Tue, 22 Sep 2026 09:02:17 GMT</pubDate><description>Public subtitle.</description><content:encoded><![CDATA[<script>secretScript()</script><p>Saudi Arabia and the Houthis affect diesel and oil supplies.</p><img src="https://example.com/tracker">${'Public preview words. '.repeat(100)}<p>DO_NOT_RETAIN_TAIL</p>]]></content:encoded></item></channel></rss>`;
 const [row]=parseRSS(xml,source,Date.parse('2026-09-22T12:00:00Z'));
 assert.equal(row.type,'Independent energy analysis');assert.match(row.evidenceStatus,/not independently verified/);assert.match(row.contentAccess,/Public RSS preview/);
 assert.ok(row.summary.length<=600);assert.ok(row.summary.endsWith('…'));assert.ok(!JSON.stringify(row).match(/secretScript|<img|DO_NOT_RETAIN_TAIL|tracker/));
 assert.equal(row.publishedAt,'2026-09-22T09:02:17.000Z');assert.equal(row.eventDate,null);assert.equal(row.url,'https://newsletter.doomberg.com/p/example');
 assert.ok(row.actors.includes('Saudi Arabia'));assert.ok(row.actors.includes('Houthis'));assert.deepEqual(row.theaters,[]);assert.equal(reportRelevant(row),true);
 assert.deepEqual(classifyReport(row).relevanceScopes,row.relevanceScopes);
});
test('analysis relevance uses the displayed preview without pulling unrelated or edible-oil content in',()=>{
 for(const summary of ['A discussion of rare earths and solar panels.','Crude palm oil prices are higher.'])assert.equal(reportRelevant(classifyReport({type:'Independent energy analysis',title:'Perspective',summary})),false);
 const xml='<rss><channel><item><title>Perspective</title><link>https://newsletter.doomberg.com/p/example</link><description>Public subtitle.</description><content:encoded><![CDATA['+'Filler words. '.repeat(80)+' Iran oil supplies.]]></content:encoded></item></channel></rss>';
 const [row]=parseRSS(xml,SOURCES.find(s=>s.id==='doomberg'));assert.equal(reportRelevant(row),false);assert.deepEqual(row.actors,[]);
});
