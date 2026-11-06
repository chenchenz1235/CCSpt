import test from 'node:test';import assert from 'node:assert/strict';
import {validateConfig,choosePage,isMainUrl} from '../scripts/common.mjs';
const base={oaUrl:'https://oa.invalid/seeyon/main.do?method=main'};
test('config rejects public CDP and embedded credentials',()=>{
 for(const cdpEndpoint of ['http://0.0.0.0:9222','http://10.0.0.1:9222','http://u:p@127.0.0.1:9222','https://127.0.0.1:9222'])assert.throws(()=>validateConfig({...base,cdpEndpoint}));
 assert.throws(()=>validateConfig({oaUrl:'https://user:password@oa.invalid/'}));assert.throws(()=>validateConfig({oaUrl:'https://oa.example.com/seeyon/main.do'}));
});
test('config retains target origin and exact main path',()=>{const c=validateConfig(base);assert.equal(c.origin,'https://oa.invalid');assert.equal(c.cdpEndpoint,'http://127.0.0.1:9222');assert.equal(isMainUrl('https://oa.invalid/seeyon/main.do?method=index',c),true);assert.equal(isMainUrl('https://other.invalid/seeyon/main.do',c),false);});
test('page choice requires a unique observed URL match',()=>{const p1={url:()=>'/one'},p2={url:()=>'/two'};assert.throws(()=>choosePage([p1,p2]));assert.throws(()=>choosePage([p1,p2],'absent'));assert.equal(choosePage([p1,p2],'two'),p2);});
