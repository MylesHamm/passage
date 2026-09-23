const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'UTC'})+' UTC':'Not yet';
let busy=false;
function setBusy(value){busy=value;$('#connect-form').setAttribute('aria-busy',String(value));for(const id of ['connect','check','disconnect'])$('#'+id).disabled=value;}
function message(text,error=false){$('#form-message').textContent=text;$('#form-message').dataset.error=String(error);}
async function request(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(50000)});const data=await r.json();if(!r.ok)throw Error((data.error||'The local connection check failed.')+(data.retryAfterSeconds?' Try again in '+data.retryAfterSeconds+' seconds.':''));return data;}
function render(data){
  const s=data.source;$('#connection-state').textContent=data.configured?s.label:'Not connected';$('#disconnect').hidden=!data.configured;
  $('#connection-description').textContent=!data.configured?(s.storageIssue?'The saved local session could not be read. Sign in again to replace it.':'Sign in to verify your ACLED API access.'):s.error?`${s.error} ${s.retrievedAt?'The previous access sample is retained and may be out of date.':'No usable sample is available.'}`:s.recordCount?'ACLED returned an event-data sample. Account tier and publication delay are not inferred from these records.':'The requests succeeded but returned no records in this sample window. This does not establish an absence of conflict.';
  $('#connection-details').innerHTML=data.configured?`<div><dt>Last successful retrieval</dt><dd>${esc(stamp(s.retrievedAt))}</dd></div><div><dt>Latest event date within this sample</dt><dd>${esc(s.newestSampleEventDate||'No dated sample')}</dd></div><div><dt>Sample size</dt><dd>${s.recordCount||0} records · maximum 10</dd></div><div><dt>Next eligible check</dt><dd>${esc(stamp(s.nextRetryAt))}</dd></div>${s.cacheIssue?`<div><dt>Storage issue</dt><dd>${esc(s.cacheIssue)}</dd></div>`:''}`:'';
  $('#sample').innerHTML=data.countries.length?data.countries.map(c=>`<h3 class="sample-country">${esc(c.country)}</h3>${c.records.map(r=>`<article class="sample-record"><h4>${esc(r.event_date)} · ${esc(r.sub_event_type||r.event_type||'Event')}</h4><p>${esc([r.actor1,r.actor2].filter(Boolean).join(' / '))}</p><p>ACLED date precision: ${r.time_precision??'not supplied'} (1 is most precise). ${r.civilian_targeting?'Civilian targeting: '+esc(r.civilian_targeting)+'.':''}</p><p>Sources recorded by ACLED: ${esc(r.source||'Not supplied')} · Event ${esc(r.event_id_cnty)}</p></article>`).join('')||'<p>No records returned for this country.</p>'}`).join(''):'<p>No account sample has been retrieved.</p>';
}
async function check(){if(busy)return;setBusy(true);try{render(await request('/api/acled'));}catch{message('Passage could not check this connection. Make sure the local server is running, then try again.',true);}finally{setBusy(false);}}
$('#connect-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;setBusy(true);message('Signing in with ACLED and checking the available data…');
  const credentials={email:$('#email').value,password:$('#password').value};$('#password').value='';
  try{const pending=request('/api/acled/connect',credentials);credentials.password='';credentials.email='';render(await pending);$('#email').value='';message('Access check complete. The local connection is saved; your password was not saved by Passage.');}
  catch(error){message(error.message||'Could not connect. Please try again.',true);}
  finally{credentials.password='';setBusy(false);}
});
$('#check').onclick=check;
$('#disconnect').onclick=async()=>{if(busy)return;setBusy(true);try{await request('/api/acled/disconnect',{});render(await request('/api/acled'));message('Local tokens and the saved sample were removed. Your ACLED account is unchanged.');}catch(error){message(error.message,true);}finally{setBusy(false);}};
check();
