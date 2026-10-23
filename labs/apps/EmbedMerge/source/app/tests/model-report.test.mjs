import test from 'node:test';import assert from 'node:assert/strict';
import {parseModelReport} from '../core/model-report.mjs';import {summarizeMatlab} from '../core/matlab-status.mjs';
const table=(rows)=>`<table class="DiffTable">${rows}</table>`;
const row=(kind,a,b)=>`<tr class="${kind}"><td>${a}</td><td>${b}</td></tr>`;
const param=s=>`<span class="Parameters">${s}</span>`;
test('official unfiltered report distinguishes layout evidence and rejects unknown export rows',()=>{
 const html=table(row('subsystem_node_path','Constant','Constant')+row('parameters',param('Position : [1, 2, 3, 4]'),param('Position : [5, 6, 7, 8]')))+table(row('nodes','模型属性','模型属性')+row('node_paths','model_TMP','model')+row('parameters',param('Modified : yesterday'),param('Modified : today')))+table(row('nodes','Thumbnail','Thumbnail')+row('node_paths','/Thumbnail','/Thumbnail')+row('parameters','<span></span>','<span></span>'))+'</html>';
 const parsed=parseModelReport(html);assert.equal(parsed.complete,true);assert.deepEqual(parsed.changes.map(c=>c.property),['Position','Model.Modified','Thumbnail']);const versions=['a','b'];assert.equal(summarizeMatlab({...parsed,versions,status:'compared'},versions).status,'minor');
 assert.equal(parseModelReport(html.replace('class="parameters"','class="new-format"')).complete,false);
 assert.equal(parseModelReport(html.replace('Position :','Position=')).complete,false);
 assert.equal(parseModelReport(html.replace('</html>','')).complete,false);
 const actual=parseModelReport(html.replaceAll('Position :','Gain :'));assert.equal(summarizeMatlab({...actual,versions,status:'compared'},versions).status,'different');
});
test('recognized R2024b empty comparison section is distinct from an unknown or truncated report',()=>{const html='<html><table class="FileInfoTable"></table><table class="EnvironmentInfoTable"></table><p class="ReportSectionHeading"><span class="ReportSectionHeading">比较结果</span></p><div></div></html>';assert.equal(parseModelReport(html).complete,true);assert.equal(parseModelReport(html).noChanges,true);assert.equal(parseModelReport('<html></html>').complete,false);assert.equal(parseModelReport(html.replace('</html>','')).complete,false);});
