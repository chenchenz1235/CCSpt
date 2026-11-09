import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reportPreview} from '../core/report-preview.mjs';

test('official report preview contains text and bundles only local images inside the report directory',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'em-report-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'job');await fs.mkdir(dir);
  const file=path.join(dir,'report.html');
  await fs.writeFile(path.join(dir,'chart.png'),Buffer.from([137,80,78,71]));
  await fs.writeFile(path.join(root,'private.png'),'private');
  await fs.writeFile(file,'<html><head></head><body><h1>模型一致</h1><img src="chart.png"><img src="../private.png"><script>parent.compromised=true</script></body></html>');
  const html=await reportPreview(root,file);
  assert.ok(html.includes('模型一致'));
  assert.ok(html.includes('src="data:image/png;base64,iVBORw=="'));
  assert.ok(!html.includes(Buffer.from('private').toString('base64')));
  assert.ok(html.indexOf('default-src')<html.indexOf('<script>'));
  assert.ok(html.includes("base-uri 'none'"));
  await assert.rejects(reportPreview(dir,path.join(root,'private.png')));
  await assert.rejects(reportPreview(root,path.join(dir,'chart.png')),/HTML/);
  await fs.writeFile(file,Buffer.from('Esafenet\0protected-content'));
  await assert.rejects(reportPreview(root,file),/官方报告未取得可读文本.*读取授权/);
});
