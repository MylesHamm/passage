// EIA's free v2 series-ID bridge preserves the survey's weekly frequency.
// https://www.eia.gov/opendata/documentation.php#APIv1
export const MARKET_SERIES = Object.freeze([
  {id:'crude-stocks',series:'WCESTUS1',name:'U.S. commercial crude stocks',units:'MBBL',displayUnit:'million barrels',scale:0.001,detail:'Crude oil excluding the Strategic Petroleum Reserve.'},
  {id:'refinery-use',series:'WPULEUS3',name:'U.S. refinery utilization',units:'%',displayUnit:'%',scale:1,detail:'Percent utilization of operable refinery capacity.'},
].map(s=>Object.freeze({...s,url:`https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=${s.series}&f=W`})));

export function parseMarketContext(payload,definition,now=Date.now()) {
  const known=MARKET_SERIES.find(s=>s.id===definition?.id);
  const response=payload?.response;
  if(!known||response?.frequency!=='weekly'||!Array.isArray(response.data)||response.data.length>5000)throw Error('Unexpected EIA weekly response');
  const observations=new Map();
  for(const row of response.data){
    if(row.series!==known.series||row.units!==known.units)throw Error('EIA weekly identity or units did not match');
    const date=row.period,ms=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date+'T00:00:00Z'):NaN;
    if(!Number.isFinite(ms)||ms>now||new Date(ms).toISOString().slice(0,10)!==date)continue;
    if(!['string','number'].includes(typeof row.value)||String(row.value).trim()==='')continue;
    const value=Number(row.value);if(!Number.isFinite(value)||value<0)continue;
    observations.set(date,{date,value});
  }
  if(!observations.size)throw Error('No valid EIA weekly observations');
  // Never return the API envelope: its request metadata can contain the key.
  return {observations:[...observations.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-104),frequency:'weekly',units:known.units,releaseDate:null};
}

export async function loadMarketContext(runtime,{apiKey,health,context={}}) {
  const series=await Promise.all(MARKET_SERIES.map(async definition=>{
    if(!apiKey)return {...definition,observations:[],...health(definition.id,{connection:'not configured',recordCount:0})};
    const data=await runtime.get(definition.id,3600,async({fetchText})=>{
      const url=new URL(`https://api.eia.gov/v2/seriesid/PET.${definition.series}.W`);
      url.searchParams.set('api_key',apiKey);url.searchParams.set('length','104');
      const parsed=parseMarketContext(JSON.parse(await fetchText(url)),definition,runtime.now());
      return {...parsed,recordCount:parsed.observations.length,latest:parsed.observations.at(-1).date,access:'Free EIA API',observationBasis:'Weekly U.S. survey; period is the week-ending observation date, not publication time'};
    },context,definition.id+'-weekly');
    return {...definition,...data,...health(definition.id,data)};
  }));
  return {series,scope:'United States',basis:'Weekly market backdrop; does not measure Middle East flows',source:'U.S. Energy Information Administration'};
}
