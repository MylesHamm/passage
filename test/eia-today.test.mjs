import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceError} from '../lib/source-runtime.mjs';
import {EIA_TODAY_SOURCE,parseEiaTodayPrices,fetchEiaToday} from '../lib/eia-today.mjs';

const html=await readFile(new URL('./fixtures/eia-today/prices-2026-10-20.html',import.meta.url),'utf8');
const now=Date.parse('2026-10-20T20:50:00Z');
const URL_PRICES='https://www.eia.gov/todayinenergy/prices.php';
const TITLE='Wholesale Spot Petroleum Prices, 10/19/26 Close';
function variant(...pairs) {
  let out=html;
  for(let i=0;i<pairs.length;i+=2) {
    const [from,to]=[pairs[i],pairs[i+1]];
    assert.equal(out.split(from).length-1,1,`fixture anchor must be unique: ${from}`);
    out=out.replace(from,to);
  }
  return out;
}
const byId=result=>Object.fromEntries(result.series.map(s=>[s.id,s]));
function assertAllNull(result,issue) {
  assert.deepEqual(result.series.map(s=>s.id),['brent','wti']);
  for(const s of result.series) {
    assert.equal(s.value,null);assert.equal(s.date,null);assert.equal(s.basis,null);assert.equal(s.vendor,null);assert.equal(s.units,null);
    assert.equal(s.issue,issue);
  }
}
const isCategory=(category,status=null)=>error=>error instanceof SourceError&&error.category===category&&error.status===status;
const serve=(body,status=200)=>async(url,options)=>{
  assert.equal(String(url),URL_PRICES);assert.ok(options.signal instanceof AbortSignal);
  return new Response(body,{status,headers:{'content-type':'text/html; charset=UTF-8'}});
};

test('real EIA page yields the dated Brent and WTI spot closes with the basis and vendor the page states',()=>{
  const result=parseEiaTodayPrices(html,now);
  assert.equal(result.asOf,'2026-10-19');
  assert.equal(result.pageDate,'2026-10-20');
  assert.deepEqual(result.series,[
    {id:'brent',name:'Brent',value:118.82,units:'$/barrel',date:'2026-10-19',basis:'Wholesale spot close (Refinitiv)',vendor:'Refinitiv',issue:null},
    {id:'wti',name:'WTI',value:110.01,units:'$/barrel',date:'2026-10-19',basis:'Wholesale spot close (Refinitiv)',vendor:'Refinitiv',issue:null},
  ]);
  // Louisiana Light, products, NYMEX futures (NA) and gas/power tables are never picked up.
  assert.equal(result.series.length,2);
});

test('a changed table layout returns null for every affected series instead of guessing',()=>{
  const changed=[
    variant('<th class="h2">Area</th>','<th class="h2">Hub</th>'),
    variant('<th class="h2">Area</th>\n                <th class="h4">Price</th>\n                <th class="h4">Percent<br>Change*</th>','<th class="h2">Area</th>\n                <th class="h4">Percent<br>Change*</th>\n                <th class="h4">Price</th>'),
    variant(TITLE,'Wholesale Spot Prices, 10/19/26 Close'),
    variant('Crude Oil<br> ($/barrel)','Crude Oil<br> ($/metric ton)'),
    variant('<td class="s2">WTI</td>','<td class="s2">WTI</td><td class="s2">Cushing</td>').replace('<td class="s2">Brent</td>','<td class="s2">Brent</td><td class="s2">Dated</td>'),
    html.replace('</body>','<table><tr><td colspan="4"><b>'+TITLE+'</b></td></tr></table></body>'),
    variant('<td class="dn">-0.4</td>\n                                    </tr>','<td class="dn">-0.4</td>\n'),
  ];
  for(const [i,page] of changed.entries())for(const s of parseEiaTodayPrices(page,now).series)assert.equal(s.value,null,`variant ${i} ${s.id}`);
  assertAllNull(parseEiaTodayPrices(changed[0],now),'layout-changed');
  for(const bad of ['','<html>Access denied</html>',null,42])assertAllNull(parseEiaTodayPrices(bad,now),bad&&typeof bad==='string'?'layout-changed':'payload-invalid');
});

test('a row that loses its product grouping is not attributed to crude oil',()=>{
  const result=byId(parseEiaTodayPrices(variant('rowspan="3">Crude Oil','rowspan="1">Crude Oil'),now));
  assert.equal(result.wti.value,110.01);
  assert.equal(result.brent.value,null);assert.equal(result.brent.issue,'layout-changed');
});

test('a missing or invalid close date returns no values and no asOf',()=>{
  for(const title of ['Wholesale Spot Petroleum Prices, Close','Wholesale Spot Petroleum Prices','Wholesale Spot Petroleum Prices, 10/19 Close']) {
    const result=parseEiaTodayPrices(variant(TITLE,title),now);
    assert.equal(result.asOf,null,title);assertAllNull(result,'date-missing');
  }
  const invalid=parseEiaTodayPrices(variant(TITLE,'Wholesale Spot Petroleum Prices, 02/30/26 Close'),now);
  assert.equal(invalid.asOf,null);assertAllNull(invalid,'date-invalid');
  const relabeled=parseEiaTodayPrices(variant(TITLE,'Wholesale Spot Petroleum Prices, 10/19/26 Settlement'),now);
  assert.equal(relabeled.asOf,null);assertAllNull(relabeled,'layout-changed');
  // The page date is a cross-check only; its absence does not block a dated table.
  const noPageDate=parseEiaTodayPrices(variant('<span class="date">October 20, 2026</span>',''),now);
  assert.equal(noPageDate.pageDate,null);assert.equal(byId(noPageDate).brent.value,118.82);
});

test('close or page dates in the future relative to now are rejected',()=>{
  const beforeClose=parseEiaTodayPrices(html,Date.parse('2026-10-18T23:59:59Z'));
  assert.equal(beforeClose.asOf,null);assertAllNull(beforeClose,'date-in-future');
  const beforePage=parseEiaTodayPrices(html,Date.parse('2026-10-19T23:00:00Z'));
  assert.equal(beforePage.asOf,null);assertAllNull(beforePage,'date-in-future');
  const futureTitle=parseEiaTodayPrices(variant(TITLE,'Wholesale Spot Petroleum Prices, 10/21/26 Close','<span class="date">October 20, 2026</span>',''),now);
  assertAllNull(futureTitle,'date-in-future');
  assertAllNull(parseEiaTodayPrices(variant('<span class="date">October 20, 2026</span>','<span class="date">October 18, 2026</span>'),now),'date-inconsistent');
});

test('a page that stopped updating does not present an old close as current',()=>{
  const later=Date.parse('2026-11-05T12:00:00Z');
  const stale=parseEiaTodayPrices(html,later);
  assert.equal(stale.asOf,'2026-10-19');assertAllNull(stale,'date-stale');
  assert.equal(byId(parseEiaTodayPrices(html,later,{maxAgeDays:30})).wti.value,110.01);
  assert.throws(()=>parseEiaTodayPrices(html,now,{maxAgeDays:-1}),RangeError);
  assert.throws(()=>parseEiaTodayPrices(html,Number.NaN),TypeError);
});

test('missing, unparseable, implausible or ambiguous values are null for that series only',()=>{
  const cases=[['NA','value-missing'],['','value-missing'],['1,118.82','value-unparseable'],['118.82.1','value-unparseable'],['$118.82','value-unparseable'],['-118.82','value-unparseable'],['1188.2','value-out-of-range'],['9.99','value-out-of-range'],['400.01','value-out-of-range']];
  for(const [value,issue] of cases) {
    const result=byId(parseEiaTodayPrices(variant('118.82',value),now));
    assert.equal(result.brent.value,null,value);assert.equal(result.brent.issue,issue,value);assert.equal(result.brent.date,null);
    assert.equal(result.wti.value,110.01,value);
  }
  const edge=byId(parseEiaTodayPrices(variant('118.82','400','110.01','10'),now));
  assert.equal(edge.brent.value,400);assert.equal(edge.wti.value,10);
  const ambiguous=byId(parseEiaTodayPrices(variant('<td class="s2">Louisiana Light</td>','<td class="s2">Brent</td>'),now));
  assert.equal(ambiguous.brent.value,null);assert.equal(ambiguous.brent.issue,'ambiguous');assert.equal(ambiguous.wti.value,110.01);
});

test('basis omits a vendor the page does not name',()=>{
  const result=byId(parseEiaTodayPrices(variant('Wholesale Spot Petroleum Prices from Refinitiv, ',''),now));
  assert.equal(result.brent.basis,'Wholesale spot close');assert.equal(result.brent.vendor,null);
  assert.equal(result.brent.value,118.82);
});

test('fetchEiaToday returns dated closes and source metadata through an injected fetch',async()=>{
  const result=await fetchEiaToday({fetchImpl:serve(html),now:()=>now});
  assert.equal(result.asOf,'2026-10-19');assert.equal(result.recordCount,2);
  assert.equal(result.retrievedAt,'2026-10-20T20:50:00.000Z');
  assert.deepEqual(byId(result).brent.value,118.82);assert.deepEqual(byId(result).wti.value,110.01);
  assert.deepEqual(result.source,{...EIA_TODAY_SOURCE});
  assert.equal(result.source.id,'eia-today');assert.equal(result.source.url,URL_PRICES);assert.equal(result.source.home,URL_PRICES);
  const partial=await fetchEiaToday({fetchImpl:serve(variant('118.82','NA')),now});
  assert.equal(partial.recordCount,1);assert.equal(byId(partial).brent.value,null);
});

test('fetchEiaToday fails with categorized errors and never caches an all-null result',async()=>{
  await assert.rejects(fetchEiaToday({fetchImpl:serve(variant('<th class="h2">Area</th>','<th class="h2">Hub</th>')),now}),
    error=>isCategory('schema')(error)&&error.issues.includes('layout-changed'));
  await assert.rejects(fetchEiaToday({fetchImpl:serve(html),now:Date.parse('2026-10-18T12:00:00Z')}),error=>isCategory('schema')(error)&&error.issues.includes('date-in-future'));
  await assert.rejects(fetchEiaToday({fetchImpl:async()=>{throw new TypeError('fetch failed');},now}),isCategory('network'));
  await assert.rejects(fetchEiaToday({fetchImpl:async()=>{throw new DOMException('The operation timed out.','TimeoutError');},now}),isCategory('timeout'));
  await assert.rejects(fetchEiaToday({fetchImpl:serve('unavailable',503),now}),isCategory('upstream_http',503));
  await assert.rejects(fetchEiaToday({fetchImpl:serve('forbidden',403),now}),isCategory('auth',403));
});
