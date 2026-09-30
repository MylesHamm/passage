import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSourceWatch,parseSourceWatchPost} from '../lib/source-watch.mjs';
import {SourceRuntime,SourceError} from '../lib/source-runtime.mjs';

const url='https://x.com/HormuzLetter/status/2105318283024961949';
const secondUrl='https://x.com/HormuzLetter/status/2105353196432679349';
const now=Date.parse('2026-09-30T16:00:00Z');
const fixture=(overrides={})=>({
 url,author_name:'The Hormuz Letter',author_url:'https://x.com/HormuzLetter',type:'rich',provider_name:'X',provider_url:'https://x.com',
 html:`<blockquote class="twitter-tweet"><p lang="en">Houthis appear to have struck a Saudi oil facility, according to initial reports. <a href="https://t.co/example">pic.twitter.com/example</a></p>&mdash; The Hormuz Letter (@HormuzLetter) <a href="${url}?ref_src=twsrc%5Etfw">September 30, 2026</a></blockquote>`,
 ...overrides,
});
const requestedFixture=address=>{
 const requested=new URL(address).searchParams.get('url');
 return fixture({url:requested,html:fixture().html.replaceAll(url,requested)});
};
const storage={readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},mkdir:async()=>{},writeFile:async()=>{}};

test('known post retains attribution, tentative language and the provider’s date precision',()=>{
 const row=parseSourceWatchPost(fixture(),url,now);
 assert.equal(row.url,url);assert.equal(row.source,'The Hormuz Letter');assert.equal(row.sourceId,'hormuz-letter');
 assert.equal(row.title,'The Hormuz Letter · source update');
 assert.equal(row.summary,'Houthis appear to have struck a Saudi oil facility, according to initial reports.');
 assert.equal(row.publishedAt,'2026-09-30T00:00:00.000Z');assert.equal(row.publicationPrecision,'day');
 assert.equal(row.dateBasis,'publisher-date');assert.equal(row.eventDate,null);assert.equal(row.discoveredAt,null);
 assert.equal(row.type,'Source report');assert.equal(row.contentAccess,'Public X post excerpt');
 assert.equal(row.evidenceStatus,'Reported by The Hormuz Letter');assert.equal(row.energy,true);
 assert.deepEqual(row.theaters,['bab']);assert.ok(row.actors.includes('Houthis'));assert.ok(row.actors.includes('Saudi Arabia'));
 assert.ok(row.matchEvidence.every(match=>match.field==='public post excerpt'));
 assert.equal(row.lat,undefined);assert.equal(row.lon,undefined);assert.equal(row.verified,undefined);
 assert.ok(!JSON.stringify(row).includes('pic.twitter.com'));
});

test('text and mentions are decoded without returning provider HTML or remote media',()=>{
 const value=fixture();value.html=value.html.replace('Houthis appear','Yemen&#39;s Houthis appear').replace('Saudi oil','Saudi &lt;img src=x onerror=alert(1)&gt; oil');
 const row=parseSourceWatchPost(value,url,now);
 assert.match(row.summary,/Yemen's Houthis appear/);assert.ok(!/[<>]/.test(row.summary));
 assert.ok(!row.summary.includes('onerror'));assert.ok(!JSON.stringify(row).includes('blockquote'));
});

test('foreign author, host, post ID and untracked URLs cannot impersonate the preferred source',()=>{
 for(const value of [
  fixture({author_url:'https://x.com/AnotherAccount'}),
  fixture({author_url:'https://x.com.evil.example/HormuzLetter'}),
  fixture({author_url:'https://user@x.com/HormuzLetter'}),
  fixture({author_name:'A different publisher'}),
  fixture({url:'https://x.com/HormuzLetter/status/12345'}),
  fixture({provider_url:'https://example.com'}),
  fixture({html:fixture().html.replace(`${url}?`, 'https://x.com/HormuzLetter/status/98765?')}),
 ])assert.throws(()=>parseSourceWatchPost(value,url,now),SourceError);
 assert.throws(()=>parseSourceWatchPost(fixture(),'https://x.com/HormuzLetter/status/98765',now),SourceError);
});

test('malformed, empty, executable or oversized embedding content is rejected',()=>{
 for(const html of [
  '', '<p>Not an embedded post</p>', fixture().html.replace('</blockquote>',''),
  fixture().html.replace(/<p[^>]*>[\s\S]*?<\/p>/,'<p> </p>'),
  fixture().html.replace(/<p[^>]*>[\s\S]*?<\/p>/,'<p><a href="https://t.co/a">pic.twitter.com/a</a></p>'),
  fixture().html+'<script>alert(1)</script>',
  fixture().html.replace('Houthis appear','<script>alert(1)</script>Houthis appear'),
  fixture().html.replace('Houthis appear','x'.repeat(70000)),
 ])assert.throws(()=>parseSourceWatchPost(fixture({html}),url,now),SourceError);
});

test('missing, impossible, relative, timestamp and future dates are not replaced by retrieval time',()=>{
 for(const date of ['', 'February 30, 2026', 'Today', 'September 30, 2026 14:01 UTC', 'October 1, 2026']){
  assert.throws(()=>parseSourceWatchPost(fixture({html:fixture().html.replace('September 30, 2026',date)}),url,now),SourceError);
 }
});

test('watcher requests only its allowlisted post and discloses that new posts are not discovered',async()=>{
 const requests=[];
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async address=>{
  requests.push(String(address));return new Response(JSON.stringify(requestedFixture(address)));
 }});
 const result=await loadSourceWatch(runtime,{entryPoint:'source-watch'});
 assert.equal(result.connection,'connected');assert.equal(result.items.length,2);assert.equal(result.recordCount,2);
 assert.equal(result.latest,'2026-09-30T00:00:00.000Z');assert.equal(result.retrievedAt,new Date(now).toISOString());
 assert.equal(result.coverage.mode,'tracked-posts');assert.equal(result.coverage.automaticDiscovery,false);
 assert.equal(result.coverage.profileUrl,'https://x.com/HormuzLetter');assert.equal(result.coverage.trackedCount,2);
 assert.match(result.coverage.limitation,/new posts are not discovered automatically/);
 const request=new URL(requests[0]);assert.equal(request.origin+request.pathname,'https://publish.x.com/oembed');
 assert.equal(request.searchParams.get('url'),url);assert.equal(request.searchParams.get('omit_script'),'true');
 assert.equal(new URL(requests[1]).searchParams.get('url'),secondUrl);
 await loadSourceWatch(runtime);assert.equal(requests.length,2);
});

test('provider failure preserves old evidence clocks and never becomes fresh coverage',async()=>{
 let tick=now,failed=false;
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>tick,fetchImpl:async address=>failed?new Response('Blocked',{status:403}):new Response(JSON.stringify(requestedFixture(address)))});
 const first=await loadSourceWatch(runtime);assert.equal(first.connection,'connected');
 tick+=301000;failed=true;
 const cached=await loadSourceWatch(runtime);
 assert.equal(cached.connection,'cached');assert.equal(cached.httpStatus,403);assert.equal(cached.errorCategory,'auth');
 assert.equal(cached.retrievedAt,first.retrievedAt);assert.equal(cached.items[0].publishedAt,first.items[0].publishedAt);
 assert.equal(cached.coverage.automaticDiscovery,false);assert.equal(cached.recordCount,2);
});

test('one missing tracked post cannot label an incomplete check as a current complete result',async()=>{
 let tick=now,partial=false;
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>tick,fetchImpl:async address=>partial&&new URL(address).searchParams.get('url')===secondUrl?new Response('Not found',{status:404}):new Response(JSON.stringify(requestedFixture(address)))});
 const first=await loadSourceWatch(runtime);assert.equal(first.items.length,2);
 tick+=301000;partial=true;
 const cached=await loadSourceWatch(runtime);
 assert.equal(cached.connection,'cached');assert.equal(cached.httpStatus,404);assert.equal(cached.recordCount,2);
 assert.equal(cached.retrievedAt,first.retrievedAt);assert.deepEqual(cached.items,first.items);
});

test('first-run provider failure or malformed data stays unavailable with empty records',async()=>{
 for(const response of [()=>new Response('Unavailable',{status:503}),()=>new Response('{invalid'),()=>new Response(JSON.stringify(fixture({author_url:'https://x.com/AnotherAccount'})))]){
  const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async()=>response()});
  const result=await loadSourceWatch(runtime);
  assert.equal(result.connection,'unavailable');assert.deepEqual(result.items,[]);assert.equal(result.recordCount,0);
  assert.equal(result.retrievedAt,undefined);assert.equal(result.latest,null);assert.equal(result.coverage.automaticDiscovery,false);
 }
});
