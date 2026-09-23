import {normalizeApiBase} from '../dist/runtime-config.mjs';

const base=normalizeApiBase(process.env.PASSAGE_API_BASE);
if(!base)throw Error('Configure the live-data service before publishing.');
const response=await fetch(new URL('api/health',base),{
  headers:{Origin:'https://myleshamm.github.io'},
  signal:AbortSignal.timeout(30000),redirect:'error',
});
if(!response.ok)throw Error(`Collector health check failed (${response.status}).`);
if(response.headers.get('access-control-allow-origin')!=='https://myleshamm.github.io')throw Error('Collector does not allow the Passage Pages origin.');
const health=await response.json();
if(health.application!=='passage-maritime-watch'||health.status!=='ready')throw Error('The configured service is not a ready Passage collector.');
console.log('Passage collector is reachable; upstream availability is reported separately in Sources.');
