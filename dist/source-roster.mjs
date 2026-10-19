const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const checked=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' UTC':'Date unavailable';
export function availableSources(sources=[]) {
  return sources.filter(source=>source.configured===true&&!source.retired&&source.successfulCheck===true&&!source.attention&&!source.checkOverdue);
}
export function sourceRosterMarkup(sources=[]) {
  const list=availableSources(sources);
  if(!list.length)return '<p class="empty">No current source updates are available. Historical evidence retains its original dates; this does not establish that no events occurred.</p>';
  return `<ul class="available-sources">${list.map(source=>`<li><div><a data-available-source="${escape(source.id)}" href="${escape(source.home)}" target="_blank" rel="noopener noreferrer">${escape(source.name)} ↗</a><small>${source.group==='news'&&['stale','empty'].includes(source.status)?'No recent relevant reports':'Checked '+escape(checked(source.retrievedAt))}</small></div></li>`).join('')}</ul>`;
}
