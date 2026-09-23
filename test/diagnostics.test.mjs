import test from 'node:test';import assert from 'node:assert/strict';
import {diagnosticSource} from '../lib/diagnostics.mjs';
test('diagnostics retain source clocks and health without any provider record bodies',()=>{
 const output=diagnosticSource({id:'imo-hormuz',connection:'connected',recordCount:75,retrievedAt:'2026-09-13T00:00:00Z',events:[{summary:'private body'}],vessels:[{mmsi:'123456789'}],countries:['Iran'],unexpected:{token:'secret'},apiKey:'secret'});
 assert.deepEqual(output,{id:'imo-hormuz',connection:'connected',recordCount:75,retrievedAt:'2026-09-13T00:00:00Z'});
});
test('diagnostics retain bounded coverage and retry metadata without copying arbitrary objects',()=>{
 const output=diagnosticSource({id:'gdelt-hormuz',attentionReason:'update',coverageStatus:'limited',consecutiveFailures:2,delayed:true,nextRetryAt:'2026-09-13T01:00:00Z',errorCategory:'network',items:[{title:'private body'}],providerState:{secret:'secret'}});
 assert.deepEqual(output,{id:'gdelt-hormuz',attentionReason:'update',coverageStatus:'limited',nextRetryAt:'2026-09-13T01:00:00Z',errorCategory:'network',consecutiveFailures:2,delayed:true});
});
