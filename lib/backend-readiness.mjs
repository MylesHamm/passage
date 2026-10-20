import {SOURCE_CAPABILITIES} from '../dist/source-policy.mjs';
import {SOURCE_DEFINITIONS} from '../dist/source-health.mjs';

const sameIds=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(id=>actual.includes(id));

// Compatibility between a deployed collector and this frontend: the same source
// identities and capability semantics, and the response shapes the panels read.
// Passing this gate says nothing about current provider health or coverage.
export function assessBackendReadiness({config,diagnostics,news,maritime,transits,oil}={}){
  const capabilityFailures=[],warnings=[];
  const fail=(id,name,reason)=>capabilityFailures.push({id,name,category:'capability',reasons:[reason]});
  for(const [endpoint,payload] of [['config',config],['news',news]]){
    for(const [name,expected] of Object.entries(SOURCE_CAPABILITIES)){
      const capability=payload?.capabilities?.[name];
      if(!capability||capability.core!==expected.core||!sameIds(capability.sourceIds,expected.sourceIds)){
        fail(`${endpoint}:${name}`,`${endpoint} ${name} capability`,'Required source IDs or core/supporting semantics do not match this frontend.');
      }
    }
  }
  const sources=Array.isArray(diagnostics?.sources)?diagnostics.sources:null;
  if(!sources)fail('diagnostics','Diagnostics source schema','Source status array is missing.');
  else {
    const ids=sources.map(source=>source?.id);
    if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)fail('diagnostics','Diagnostics source schema','Source IDs must be present and unique.');
    const missing=SOURCE_DEFINITIONS.map(source=>source.id).filter(id=>!ids.includes(id));
    if(missing.length)fail('diagnostics-inventory','Diagnostics source inventory',`The collector does not report: ${missing.join(', ')}.`);
    const unknown=ids.filter(id=>!SOURCE_DEFINITIONS.some(source=>source.id===id));
    if(unknown.length)fail('diagnostics-inventory','Diagnostics source inventory',`The collector reports sources this frontend does not show: ${unknown.join(', ')}.`);
  }
  if(!Array.isArray(maritime?.events)||maritime?.coverage?.complete!==false)fail('maritime-schema','Incident register schema','Incident records and an explicit incomplete-coverage flag are required.');
  if(transits!==undefined&&(!Array.isArray(transits?.daily)||typeof transits?.baselines!=='object'||transits.baselines===null))fail('transits-schema','Transit schema','Daily transit rows and labelled baselines are required.');
  if(oil!==undefined&&(!Array.isArray(oil?.series)||!Array.isArray(oil?.latestCloses)))fail('oil-schema','Oil schema','Daily series and next-day closes are required.');
  if(!Array.isArray(news?.items))fail('news-schema','Reporting schema','Reporting items are required.');
  warnings.push({id:'coverage',name:'Coverage',category:'coverage',reasons:['Received AIS covers part of Hormuz only; incident registers and reporting are not complete event records.']});
  return {ready:capabilityFailures.length===0,compatible:capabilityFailures.length===0,coverageEstablished:false,capabilityFailures,coverageFailures:[],failures:capabilityFailures,warnings};
}
