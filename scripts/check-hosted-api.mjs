import {normalizeApiBase} from '../dist/runtime-config.mjs';
import {pathToFileURL} from 'node:url';
import {assessPassageReadiness} from '../lib/release-readiness.mjs';
import {assessBackendReadiness} from '../lib/backend-readiness.mjs';

const ORIGIN='https://myleshamm.github.io';
export async function checkHostedApi({base=process.env.PASSAGE_API_BASE,fetchImpl=fetch,now=Date.now}={}){
  base=normalizeApiBase(base);
  if(!base)throw Error('Configure the live-data service before publishing.');
  async function read(endpoint){
    // Use ordinary public reads and provider TTLs. Never force a refresh,
    // bypass caches, or turn a read/heartbeat into a successful source clock.
    const response=await fetchImpl(new URL('api/'+endpoint,base),{
      headers:{Origin:ORIGIN},signal:AbortSignal.timeout(30000),redirect:'error',
    });
    if(!response.ok)throw Error(`Collector ${endpoint} check failed (${response.status}).`);
    if(response.headers.get('access-control-allow-origin')!==ORIGIN)throw Error(`Collector ${endpoint} does not allow the Passage Pages origin.`);
    return response.json();
  }
  const health=await read('health');
  if(health?.application!=='passage-maritime-watch'||health?.status!=='ready')throw Error('The configured service is not a ready Passage collector.');
  const config=await read('config'),news=await read('news'),maritime=await read('maritime'),transits=await read('transits'),oil=await read('oil'),events=await read('events');
  const diagnostics=await read('diagnostics'),checkedAt=now();
  const core=assessPassageReadiness({health,diagnostics,now:checkedAt});
  const backend=assessBackendReadiness({config,diagnostics,news,maritime,transits,oil,events});
  const failures=[...core.failures.map(failure=>({...failure,category:'core-source-health'})),...backend.failures];
  const result={...core,ready:core.ready&&backend.ready,failures,backend,warnings:[...core.warnings,...backend.warnings]};
  if(!result.ready){
    const error=Error('Passage is not ready for publication:\n'+failures.map(failure=>`[${failure.category}] ${failure.name}: ${failure.reasons.join(' ')}`).join('\n'));
    error.result=result;
    throw error;
  }
  return result;
}

function reportWarnings(warnings=[]){
  for(const warning of warnings)console.warn(`[${warning.category||'source-health'}] ${warning.name}: ${warning.reasons.join(' ')} Last successful retrieval: ${warning.retrievedAt||'none'}. Next retry: ${warning.nextRetryAt||'not reported'}.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await checkHostedApi();
    console.log(`Passage release checks passed: ${result.verifiedCount} core source checks verified; the collector matches this frontend's sources and response shapes. This does not establish complete coverage.`);
    reportWarnings(result.warnings);
  }catch(error){
    console.error(error.message);reportWarnings(error.result?.warnings);process.exitCode=1;
  }
}
