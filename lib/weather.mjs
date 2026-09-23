import {THEATERS} from './feeds.mjs';
const specifications={marine:{wave_height:['m',0,40],wave_period:['s',0,100],sea_surface_temperature:['°C',-5,60]},wind:{wind_speed_10m:['km/h',0,500]}};
const currentSpecs={temperature_2m:['°C',-100,80],wind_speed_10m:['km/h',0,500],wind_direction_10m:['°',0,360]};
export function weatherTime(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))throw Error('Unexpected model time');const ms=Date.parse(s+'Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,16)!==s)throw Error('Invalid model time');return ms;}
function value(n,[,min,max]){if(n===null||n===undefined)return null;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error('Invalid model value');return n;}
// https://open-meteo.com/en/docs#api-documentation and /en/docs/marine-weather-api
// Bind by returned grid coordinates, not response ordering. A 0.75-degree bound
// is Passage's sanity policy, not the provider's promised grid resolution.
export function normalizeWeather(payload,kind){
 if(!specifications[kind]||!Array.isArray(payload)||payload.length!==THEATERS.length)throw Error('Unexpected weather locations');
 const byTheater=new Map();
 for(const model of payload){
  if(!Number.isFinite(model.latitude)||!Number.isFinite(model.longitude)||model.utc_offset_seconds!==0)throw Error('Weather grid/timezone mismatch');
  const candidates=THEATERS.filter(t=>Math.abs(model.latitude-t.lat)<.75&&Math.abs(model.longitude-t.lon)<.75);
  if(candidates.length!==1||byTheater.has(candidates[0].id))throw Error('Weather location association failed');
  const times=model.hourly?.time;if(!Array.isArray(times)||!times.length||times.length>200||model.hourly_units?.time!=='iso8601')throw Error('Unexpected hourly model');
  const ms=times.map(weatherTime);if(ms.some((v,i)=>i&&v-ms[i-1]!==3600000))throw Error('Misaligned forecast hours');
  const hourly={time:times},missing=[];
  for(const [key,spec] of Object.entries(specifications[kind])){
   const values=model.hourly[key];if(values===undefined){hourly[key]=times.map(()=>null);missing.push(key);continue;}
   if(!Array.isArray(values)||values.length!==times.length||model.hourly_units[key]!==spec[0])throw Error('Weather units or series alignment changed');
   hourly[key]=values.map(v=>value(v,spec));if(hourly[key].some(v=>v===null))missing.push(key);
  }
  let current=null;
  if(kind==='wind'&&model.current){weatherTime(model.current.time);if(model.current_units?.time!=='iso8601')throw Error('Unexpected current model units');current={time:model.current.time};for(const [key,spec] of Object.entries(currentSpecs)){if(model.current[key]!=null&&model.current_units?.[key]!==spec[0])throw Error('Current weather units changed');current[key]=value(model.current[key],spec);}}
  byTheater.set(candidates[0].id,{latitude:model.latitude,longitude:model.longitude,requestedLatitude:candidates[0].lat,requestedLongitude:candidates[0].lon,utc_offset_seconds:0,timezone:'GMT',hourly,hourly_units:model.hourly_units,current,modelRunAt:null,cellSelection:'sea',validFrom:new Date(ms[0]).toISOString(),validThrough:new Date(ms.at(-1)+3600000).toISOString(),missingVariables:missing});
 }
 return THEATERS.map(t=>byTheater.get(t.id));
}
