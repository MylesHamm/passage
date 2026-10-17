import test from 'node:test';
import assert from 'node:assert/strict';
import {reportClockRows,reportInspectorMarkup,safeSourceUrl} from '../dist/report-inspector.mjs';
const report={id:'one',source:'Publisher',title:'Iran may suspend oil exports',url:'https://news.example.com/story',theaters:['hormuz'],publishedAt:'2026-10-15T09:00:00Z',discoveredAt:'2026-10-15T11:00:00Z'};
test('inspector starts with original source and keeps unknown event clock separate',()=>{
 const html=reportInspectorMarkup(report,{source:{lastSuccessAt:'2026-10-17T05:00:00Z'}});
 assert.ok(html.indexOf('Read original source')<html.indexOf('record-tabs'));
 assert.match(html,/Iran may suspend oil exports/);assert.match(html,/Event date<\/span><strong>Not established/);
 const rows=reportClockRows(report,{lastSuccessAt:'2026-10-17T05:00:00Z',lastAttemptAt:'2026-10-17T06:00:00Z'});
 assert.equal(rows[0].value,undefined);assert.equal(rows[1].value,report.publishedAt);assert.equal(rows[3].value,'2026-10-17T05:00:00Z');
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
