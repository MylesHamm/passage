import {SOURCE_CAPABILITIES} from '../../dist/source-policy.mjs';
import {SOURCE_DEFINITIONS} from '../../dist/source-health.mjs';

// A collector whose public contract matches this frontend.
export function backendFixture(now=Date.parse('2026-09-28T19:00:00Z')){
  const retrievedAt=new Date(now-60000).toISOString();
  const sources=SOURCE_DEFINITIONS.map(source=>({id:source.id,configured:true,connection:'connected',status:'current',retrievedAt,recordCount:3,capability:source.capability}));
  return structuredClone({now,
    config:{capabilities:SOURCE_CAPABILITIES},
    diagnostics:{sources},
    news:{items:[],sources:[],capabilities:SOURCE_CAPABILITIES,coverage:{complete:false}},
    maritime:{events:[],sources:[],coverage:{complete:false}},
    transits:{daily:[{chokepoint:'hormuz',date:'2026-09-27',tankers:2,total:4}],baselines:{hormuz:{label:'2025 daily average',total:85.5,tankers:48.2}}},
    oil:{series:[],latestCloses:[]},
    events:{schema:'passage-war-events/v1',reviewedAt:'2026-09-28T18:00:00Z',events:[],missions:[]},
  });
}
/** Diagnostics with each id once: explicit test entries win over the fixture's. */
export function mergeSources(primary=[],secondary=[]){
  return [...primary,...secondary.filter(source=>!primary.some(entry=>entry.id===source.id))];
}
