import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResearchGraphSvg,buildResearchTimelineSvg} from '../dist/research-charts.mjs';
import {buildTimeline} from '../dist/research-data.mjs';

const graph={
  reports:Array.from({length:12},(_,index)=>({url:`https://example.test/${index}`,source:'Middle East Eye',title:`Full source title ${index}`})),
  entities:Array.from({length:16},(_,index)=>({id:`entity-${index}`,label:index?'Maritime coalitions':'Long entity <with> & a full title',type:'actor'})),
  edges:[{from:'report:https://example.test/0',to:'entity-0'}],
};
const dateNow=Date.parse('2026-10-13T12:00:00Z');
const timeline=days=>buildTimeline([],[{id:'brent',observations:[{date:'2026-10-12',value:80},{date:'2026-10-13',value:81}]}],{days,now:dateNow});
const dateLabels=markup=>[...markup.matchAll(/<text class="timeline-label timeline-date" x="([^"]+)" y="[^"]+" text-anchor="([^"]+)">([^<]+)<\/text>/g)].map(([,x,anchor,text])=>({x:Number(x),anchor,text}));

test('Research network keeps all bounded records at readable spacing on narrow and wide canvases',()=>{
  for(const width of [249,319,359,640,1000]){
    const svg=buildResearchGraphSvg(graph,width);
    assert.equal(svg.width,Math.max(640,width));assert.equal(svg.height,424);
    const sourceRows=[...svg.markup.matchAll(/class="graph-report" cx="([^"]+)" cy="([^"]+)"/g)];
    const entityRows=[...svg.markup.matchAll(/class="graph-entity [^"]*" cx="([^"]+)" cy="([^"]+)"/g)];
    assert.equal(sourceRows.length,12);assert.equal(entityRows.length,16);
    for(const rows of [sourceRows,entityRows])for(let index=1;index<rows.length;index++)assert.ok(Number(rows[index][2])-Number(rows[index-1][2])>=24);
    assert.ok(Number(sourceRows[0][1])<Number(entityRows[0][1]),'source and entity columns stay distinct');
    assert.match(svg.markup,/<title>Middle East Eye · Full source title 0<\/title>/);
    assert.match(svg.markup,/<title>Long entity &lt;with&gt; &amp; a full title<\/title>/);
    assert.doesNotMatch(svg.markup,/<with>/);
  }
});

test('timeline endpoints retain full calendar dates with enough room at 320–430px page widths',()=>{
  for(const width of [249,319,359,479,480,1000]){
    const svg=buildResearchTimelineSvg(timeline(365),width,228),labels=dateLabels(svg.markup);
    assert.equal(svg.width,width);assert.equal(svg.height,228);
    assert.equal(labels.length,width<480?2:4);
    assert.equal(labels[0].text,'Oct 14, 2025');assert.equal(labels.at(-1).text,'Oct 13, 2026');
    const bounds=labels.map(label=>{
      const textWidth=label.text.length*7.2; // 12px monospace labels, checked again in the browser.
      const start=label.x-(label.anchor==='end'?textWidth:label.anchor==='middle'?textWidth/2:0);
      return{start,end:start+textWidth};
    });
    for(let index=0;index<bounds.length;index++){
      assert.ok(bounds[index].start>=0&&bounds[index].end<=width);
      if(index)assert.ok(bounds[index].start>bounds[index-1].end,'date labels must not overlap');
    }
    assert.doesNotMatch(svg.markup,/NaN|undefined/);
  }
});

test('empty charts use a fitting native canvas and wrapped copy without inventing observations',()=>{
  const emptyGraph=buildResearchGraphSvg({reports:[],entities:[],edges:[]},249);
  const emptyTimeline=buildResearchTimelineSvg(buildTimeline([],[],{days:30,now:dateNow}),249,228);
  for(const svg of [emptyGraph,emptyTimeline]){
    assert.equal(svg.width,249);assert.match(svg.markup,/<tspan/);
    assert.doesNotMatch(svg.markup,/<path|<circle/);
    const lines=[...svg.markup.matchAll(/<tspan[^>]*>([^<]+)<\/tspan>/g)].map(match=>match[1]);
    assert.ok(lines.length>1);assert.ok(lines.every(line=>line.length*7.2<=249-32));
  }
});
