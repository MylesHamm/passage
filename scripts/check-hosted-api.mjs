import {normalizeApiBase} from '../dist/runtime-config.mjs';
import {pathToFileURL} from 'node:url';
import {assessReportingReadiness} from '../lib/release-readiness.mjs';

const ORIGIN='https://myleshamm.github.io';
export async function checkHostedApi({base=process.env.PASSAGE_API_BASE,fetchImpl=fetch,now=Date.now}={}){
  base=normalizeApiBase(base);
  if(!base)throw Error('Configure the live-data service before publishing.');
  async function read(endpoint){
    // Read the scheduled collector's actual results. Do not force a refresh or
    // disguise stale data by changing the URL or bypassing the provider cache.
    const response=await fetchImpl(new URL('api/'+endpoint,base),{
      headers:{Origin:ORIGIN},signal:AbortSignal.timeout(30000),redirect:'error',
    });
    if(!response.ok)throw Error(`Collector ${endpoint} check failed (${response.status}).`);
    if(response.headers.get('access-control-allow-origin')!==ORIGIN)throw Error(`Collector ${endpoint} does not allow the Passage Pages origin.`);
    return response.json();
  }
  const health=await read('health');
  if(health?.application!=='passage-maritime-watch'||health?.status!=='ready')throw Error('The configured service is not a ready Passage collector.');
  const diagnostics=await read('diagnostics');
  const result=assessReportingReadiness({health,diagnostics,now:now()});
  if(!result.ready)throw Error('Core reporting is not ready for publication:\n'+result.failures.map(failure=>`${failure.name}: ${failure.reasons.join(' ')}`).join('\n'));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await checkHostedApi();
  console.log(`Passage collector verified: ${result.verifiedCount} core reporting feeds have recent successful retrievals and relevant publications. Auxiliary source coverage remains reported separately in Sources.`);
}
