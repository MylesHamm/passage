import test from 'node:test';
import assert from 'node:assert/strict';
import {reportClockRows,reportInspectorMarkup,safeSourceUrl} from '../dist/report-inspector.mjs';
const report={id:'one',source:'Publisher',title:'Iran may suspend oil exports',url:'https://news.example.com/story',theaters:['hormuz'],publishedAt:'2026-10-15T09:00:00Z',discoveredAt:'2026-10-15T11:00:00Z'};
test('inspector starts with original source and keeps unknown event clock separate',()=>{
 const html=reportInspectorMarkup(report,{source:{lastSuccessAt:'2026-10-17T05:00:00Z'}});
 assert.ok(html.indexOf('Read original source')<html.indexOf('record-tabs'));
 assert.match(html,/Iran may suspend oil exports/);assert.match(html,/Event date<\/span><strong>Not established/);
 const rows=reportClockRows(report,{lastSuccessAt:'2026-10-17T05:00:00Z',lastAttemptAt:'2026-10-17T06:00:00Z'});
 assert.equal(rows.some(row=>row.label==='Event'),false);assert.equal(rows.find(row=>row.label==='Publication').value,report.publishedAt);assert.equal(rows.find(row=>row.label==='Source retrieval').value,'2026-10-17T05:00:00Z');
});
test('inspector preserves kinds, discovery access, source uncertainty and safe markup',()=>{
 const html=reportInspectorMarkup({...report,recordKind:'agency-assessment',contentAccess:'discovery-metadata',summary:'<script>x</script>',title:'Agency <claim>'});
 assert.match(html,/Agency assessment · Discovery metadata/);assert.match(html,/Agency &lt;claim&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/A discovered link does not verify/);assert.match(html,/not a publication or event date/);
});
test('inspector rejects credential-bearing, private and unsupported source destinations',()=>{
 for(const value of ['javascript:alert(1)','https://user:secret@example.com/a','http://127.0.0.1/a','https://10.0.0.1/a','https://example.com/a?token=secret'])assert.equal(safeSourceUrl(value),null,value);
 assert.equal(safeSourceUrl('https://example.com/a?utm_source=ref'),'https://example.com/a');
 assert.doesNotMatch(reportInspectorMarkup({...report,url:'javascript:alert(1)'}),/href="javascript:/);
});
test('inspector exposes keyboard tabs and possible mechanisms without duplicated price tiles',()=>{
 const html=reportInspectorMarkup(report);
 assert.equal((html.match(/role="tab"/g)||[]).length,3);assert.equal((html.match(/role="tabpanel"/g)||[]).length,3);
 assert.match(html,/POSSIBLE CONNECTION \/ NOT A MEASURED EFFECT/);assert.match(html,/id="inspect-report-system"/);assert.doesNotMatch(html,/Latest available \$|price-comparison/);
});

test('regional report tags never present Tehran or Yemen text matches as waterway locations',()=>{
 const iran=reportInspectorMarkup({...report,title:'Pakistan suspends Iran border trade, amid violence on both sides'});
 assert.match(iran,/Iran &amp; Gulf context/);
 assert.doesNotMatch(iran,/<span>Hormuz<\/span>|<span>Strait of Hormuz<\/span>/);
 const yemen=reportInspectorMarkup({...report,title:'Yemen ceasefire talks resume',theaters:['bab']});
 assert.match(yemen,/Yemen &amp; Red Sea context/);
 assert.match(yemen,/do not verify a location or responsibility/);
});

test('archived record retrieval never advances to the publisher latest successful check',()=>{
 for(const flag of ['retainedFromHistory','collectionRetired','retainedForReading']){
  const archived={...report,[flag]:true,lastSeenAt:'2026-10-18T08:00:00Z'},source={lastSuccessAt:'2026-10-19T10:00:00Z'};
  const rows=reportClockRows(archived,source);
  assert.equal(rows.find(row=>row.label==='Record retrieval').value,archived.lastSeenAt);
  const html=reportInspectorMarkup(archived,{source});
  assert.match(html,/<dt>Record retrieval<\/dt><dd>18 Oct 2026 · 08:00 UTC/);
  assert.match(html,/<dt>Source retrieval<\/dt><dd>19 Oct 2026 · 10:00 UTC/);
  assert.equal(reportClockRows({...archived,lastSeenAt:null},source).some(row=>row.label==='Record retrieval'),false);
 }
});

test('shared evidence block preserves report reading tabs, actions and private notes',()=>{
 const html=reportInspectorMarkup({...report,summary:'Publisher summary'},{saved:true,note:'My <assessment>',source:{retrievedAt:'2026-10-19T12:00:00Z'}});
 assert.match(html,/aria-label="Source and evidence"/);assert.match(html,/Verification limits/);
 for(const id of ['record-tab-claim','record-tab-confirm','record-tab-oil','record-claim','record-confirm','record-oil','detail-save','analyst-note','save-note','inspect-official-records','inspect-report-system'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/Saved ✓/);assert.match(html,/My &lt;assessment&gt;/);
 assert.match(html,/Possible oil-market connections are interpretation/);
 assert.ok(html.indexOf('Read original source')<html.indexOf('record-tabs'));
});
