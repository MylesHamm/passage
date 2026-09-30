const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const validNumber=value=>typeof value==='number'&&Number.isFinite(value);
const money=value=>validNumber(value)&&value>=0?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value):'Not supplied';
const date=value=>instant(value)!==null?new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Not supplied';
const percent=value=>!validNumber(value)||value<0||value>1?'—':value>0&&value<.001?'<0.1%':value<1&&value>.999?'>99.9%':`${(value*100).toFixed(1).replace(/\.0$/,'')}%`;

function marketUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&['polymarket.com','www.polymarket.com'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname.startsWith('/event/')?url.href:null;}catch{return null;}
}

// Retrieval health and contract deadlines are independent: a retained quote
// keeps its original clock, and a contract disappears when its deadline passes.
export function expectationsModel(data,{theater='both',failed=false,now=Date.now()}={}){
  const source=data?.source||{},retrievedAt=source.lastSuccessAt||source.retrievedAt||null,at=instant(retrievedAt);
  const rows=(Array.isArray(data?.markets)?data.markets:[]).filter(market=>market&&typeof market.question==='string'&&market.question.trim()&&instant(market.endDate)>now);
  const markets=rows.filter(market=>theater==='both'||market.theater===theater||market.theater==='both');
  const updateFailed=failed||['retained','unavailable'].includes(source.status)||['cached','unavailable','disconnected'].includes(source.connection)||Boolean(source.error||source.localFailure);
  const overdue=at!==null&&now-at>(source.freshnessAfterSeconds??600)*1000;
  const stale=source.status==='stale'||source.freshness==='stale'||overdue;
  const status=!data&&!failed?'loading':updateFailed?(markets.length?'retained':'unavailable'):stale?'stale':at===null||at>now+60000?'unknown':!markets.length?'empty':'current';
  const labels={loading:'Checking prices',retained:'Update failed · retained prices',unavailable:'Prices unavailable',stale:'Prices need refreshing',unknown:'Retrieval time unknown',empty:'No matching active markets',current:'Prices retrieved'};
  return {markets,status,label:labels[status],retrievedAt,scope:theater==='bab'?'Bab el-Mandeb':theater==='hormuz'?'Hormuz':'Both theatres',notes:(Array.isArray(data?.notes)?data.notes:[]).filter(note=>typeof note==='string'&&note.trim())};
}

function marketMarkup(market,index){
  const key=String(market.id??index),url=marketUrl(market.url),price=percent(market.probability),hasPrice=price!=='—';
  const basis=({midpoint:'Bid/ask midpoint','Gamma order-book midpoint':'Bid/ask midpoint',last_trade:'Last trade',lastTrade:'Last trade','Gamma last trade':'Last trade',gamma:'Market price',outcome_price:'Market price',outcomePrices:'Market price'})[market.priceBasis]||market.priceBasis||'Not supplied';
  return `<article class="expectation-row">
    <div class="expectation-question"><h3>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-expectations-key="link:${esc(key)}">${esc(market.question)}<span aria-hidden="true"> ↗</span></a>`:esc(market.question)}</h3><div class="expectation-probability"><strong>${esc(price)}</strong><span>${hasPrice?'YES':'No price'}</span></div></div>
    ${hasPrice?`<div class="expectation-scale" aria-hidden="true"><span style="width:${(market.probability*100).toFixed(2)}%"></span></div>`:''}<p class="expectation-deadline">Market end date ${esc(date(market.endDate))} · YES probability</p>
    <details class="expectation-details" data-expectations-section="market:${esc(key)}"><summary data-expectations-key="details:${esc(key)}">Market details</summary><dl>
      <div><dt>Deadline</dt><dd>${esc(date(market.endDate))}</dd></div>
      <div><dt>Liquidity</dt><dd>${esc(money(market.liquidityUsd))}</dd></div>
      <div><dt>24h volume</dt><dd>${esc(money(market.volume24hUsd))}</dd></div>
      <div><dt>Price basis</dt><dd>${esc(hasPrice?basis:'Price unavailable')}</dd></div>
      <div><dt>YES bid / ask</dt><dd>${esc(percent(market.bestBid))} / ${esc(percent(market.bestAsk))}</dd></div>
      <div><dt>Market updated</dt><dd>${esc(date(market.updatedAt))}</dd></div>
    </dl>${market.description?`<p class="expectation-rules">${esc(market.description)}</p>`:''}${url?`<a class="expectation-rules-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-expectations-key="rules:${esc(key)}">Read full resolution rules ↗</a>`:''}<p class="expectation-caveat">Prices reflect participants’ expectations under this market’s rules. Liquidity and trading activity affect how informative they are.</p></details>
  </article>`;
}

export function renderExpectations(data,options={}){
  const model=expectationsModel(data,options),{markets,status}=model;
  const empty=status==='loading'?'Retrieving active shipping and regional oil markets…':status==='unavailable'?'Polymarket could not be refreshed. Passage will retry automatically.':`No active markets retrieved for ${model.scope}. This is a market coverage gap, not evidence of calm.`;
  return `<div class="panel-heading expectations-heading"><h2>Market expectations</h2><a href="https://polymarket.com/" target="_blank" rel="noopener noreferrer" data-expectations-key="provider">Polymarket ↗</a></div>
    <p class="expectations-context">Market-implied probability · not event confirmation</p>
    <div class="expectations-status" data-state="${status}"><span>${esc(model.label)}</span><small>${model.retrievedAt?`Retrieved ${esc(date(model.retrievedAt))}`:status==='loading'?'Public markets · no account needed':'No successful retrieval time recorded'}</small></div>
    <div class="expectations-list"${status==='loading'?' aria-busy="true"':''}>${markets.length?markets.slice(0,3).map(marketMarkup).join(''):`<p class="expectations-empty" role="status">${esc(empty)}</p>`}</div>
    ${markets.length>3?`<details class="expectations-more" data-expectations-section="more"><summary data-expectations-key="more">${markets.length-3} more ${markets.length===4?'market':'markets'}</summary>${markets.slice(3).map((market,index)=>marketMarkup(market,index+3)).join('')}</details>`:''}
    ${model.notes.length?`<details class="expectations-notes" data-expectations-section="notes"><summary data-expectations-key="notes">Coverage & selection</summary><ul>${model.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></details>`:''}`;
}

export function createExpectationsView(host,{getState,now=Date.now}={}){
  let previous='';
  function update(){
    if(!host)return;
    const state=getState(),html=renderExpectations(state.expectations,{theater:state.theater,failed:state.failures?.expectations,now:now()});
    if(html===previous)return;
    const open=new Set([...host.querySelectorAll('details[open]')].map(node=>node.dataset.expectationsSection));
    const active=host.ownerDocument.activeElement,key=host.contains(active)?active.dataset.expectationsKey:null;
    host.innerHTML=html;previous=html;
    for(const node of host.querySelectorAll('details'))node.open=open.has(node.dataset.expectationsSection);
    if(key){
      const target=[...host.querySelectorAll('[data-expectations-key]')].find(node=>node.dataset.expectationsKey===key);
      const fallback=host.querySelector('[data-expectations-key="provider"]');
      (target?.getClientRects().length?target:fallback)?.focus({preventScroll:true});
    }
  }
  return {update};
}
