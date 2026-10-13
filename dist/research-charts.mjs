const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shortLabel=(value,max)=>value.length>max?value.slice(0,max-1)+'…':value;
const fmtDate=value=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

function emptyText(message,width,height,className){
  const capacity=Math.max(12,Math.floor((width-32)/7.2)),lines=[];
  for(const word of message.split(' ')){
    if(!lines.length||lines.at(-1).length+word.length+1>capacity)lines.push(word);
    else lines[lines.length-1]+=' '+word;
  }
  return `<text class="${className}" x="16" y="${Math.max(24,(height-lines.length*18)/2)}">${lines.map((line,index)=>`<tspan x="16" dy="${index?18:0}">${esc(line)}</tspan>`).join('')}</text>`;
}

// The SVG uses native CSS-pixel dimensions. Narrow screens scroll the graph
// within its labelled region instead of shrinking its labels and connections.
export function buildResearchGraphSvg(graph,viewportWidth){
  const reports=graph.reports.slice(0,12),entities=graph.entities.slice(0,16);
  const width=Math.max(reports.length?640:1,Math.floor(viewportWidth));
  const height=Math.max(240,64+(Math.max(reports.length,entities.length)-1)*24);
  if(!reports.length)return{width,height,markup:emptyText('No source-linked headlines are available for this graph.',width,height,'graph-label')};
  const left=224,right=width-224;
  const rowY=(index,count)=>(height-(count-1)*24)/2+index*24;
  const reportY=index=>rowY(index,reports.length),entityY=index=>rowY(index,entities.length);
  const links=graph.edges.map(edge=>{
    const reportIndex=reports.findIndex(report=>'report:'+report.url===edge.from),entityIndex=entities.findIndex(entity=>entity.id===edge.to);
    return reportIndex>=0&&entityIndex>=0?`<line class="graph-line" x1="${left}" y1="${reportY(reportIndex)}" x2="${right}" y2="${entityY(entityIndex)}"></line>`:'';
  }).join('');
  const sources=reports.map((report,index)=>`<g><title>${esc((report.source||'Source')+' · '+report.title)}</title><circle class="graph-report" cx="${left}" cy="${reportY(index)}" r="6"></circle><text class="graph-label" x="${left-14}" y="${reportY(index)+4}" text-anchor="end">${esc(shortLabel(report.source||'Source',24))}</text></g>`).join('');
  const labels=entities.map((entity,index)=>`<g><title>${esc(entity.label)}</title><circle class="graph-entity ${entity.type==='theater'?'graph-theater':''}" cx="${right}" cy="${entityY(index)}" r="6"></circle><text class="graph-label entity" x="${right+14}" y="${entityY(index)+4}">${esc(shortLabel(entity.label,26))}</text></g>`).join('');
  return{width,height,markup:links+sources+labels};
}

export function buildResearchTimelineSvg(timeline,viewportWidth,viewportHeight){
  const width=Math.max(1,Math.floor(viewportWidth)),height=Math.max(1,Math.floor(viewportHeight));
  const rows=timeline.rows,prices=rows.flatMap(row=>Object.values(row.prices).filter(Number.isFinite));
  if(!prices.length)return{width,height,markup:emptyText('No EIA observations are available for this window.',width,height,'timeline-label')};
  const pad={l:46,r:20,t:22,b:31};
  const min=Math.floor(Math.min(...prices)/10)*10,max=Math.max(min+10,Math.ceil(Math.max(...prices)/10)*10);
  const x=index=>pad.l+(rows.length<2?0:index/(rows.length-1))*(width-pad.l-pad.r);
  const y=value=>pad.t+(max-value)/(max-min)*(height-pad.t-pad.b);
  // Preserve the existing observation/path semantics; only the chart layout changes.
  const pathFor=id=>rows.map((row,index)=>Number.isFinite(row.prices[id])?`${index?'L':'M'}${x(index).toFixed(1)},${y(row.prices[id]).toFixed(1)}`:'').filter(Boolean).join(' ');
  const reportPoints=rows.map((row,index)=>row.reports.length?`<circle class="timeline-report" cx="${x(index)}" cy="${y(min)}" r="4"><title>${esc(row.date)} · ${row.reports.length} disruption ${row.reports.length===1?'mention':'mentions'}</title></circle>`:'').join('');
  const ratios=width<480?[0,1]:[0,.33,.66,1];
  const ticks=ratios.map(ratio=>{
    const index=Math.round((rows.length-1)*ratio);
    return `<line class="timeline-grid" x1="${x(index)}" x2="${x(index)}" y1="${pad.t}" y2="${height-pad.b}"></line><text class="timeline-label timeline-date" x="${x(index)}" y="${height-9}" text-anchor="${ratio===0?'start':ratio===1?'end':'middle'}">${esc(fmtDate(rows[index].date+'T00:00:00Z'))}</text>`;
  }).join('');
  return{width,height,markup:`${ticks}<line class="timeline-axis" x1="${pad.l}" x2="${width-pad.r}" y1="${y(min)}" y2="${y(min)}"></line><path class="timeline-price-brent" d="${pathFor('brent')}"></path><path class="timeline-price-wti" d="${pathFor('wti')}"></path>${reportPoints}<text class="timeline-label" x="8" y="${y(max)+3}">$${max}</text><text class="timeline-label" x="8" y="${y(min)+3}">$${min}</text>`};
}
