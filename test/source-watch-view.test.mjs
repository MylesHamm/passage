import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('preferred source links to the account within the briefing and discloses no automatic collection',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 const brief=html.match(/<section class="priority-watch"[\s\S]*?<\/section>/)?.[0];
 assert.ok(brief,'The account reference belongs inside the live briefing.');
 assert.match(brief,/id="priority-watch"/);
 assert.match(brief,/Preferred source ·/);
 assert.match(brief,/href="https:\/\/x\.com\/HormuzLetter" target="_blank" rel="noopener noreferrer"/);
 assert.match(brief,/X account; not automatically collected/);
 assert.doesNotMatch(html,/id="source-watch"|source-watch-shortcut|HormuzLetter\/status\//);
});

test('main dashboard neither requests nor exports the retired fixed-post watch and preserves live market requests',async()=>{
 const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/sourceWatch|\/api\/source-watch|source-watch-view/);
 assert.match(app,/\['news','\/api\/news',35000\]/);
 assert.match(app,/\['expectations','\/api\/expectations',35000\]/);
 assert.match(app,/expectations:state\.expectations/);
});
