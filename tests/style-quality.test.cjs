const { test } = require('node:test');
const assert = require('node:assert/strict');
const {inspect, compile} = require('../style-quality.js');
function fixture() {
  return { context: { source_pages:['P.1','P.7'], pixel_evidence:[{source_page:'P.7',lightRatio:.8,darkRatio:.05}] },
    profile: { rules: [], layouts: [
      {id:'Q',name:'封面',description:'左文右圖',source_pages:['P.1']},
      {id:'B',name:'四欄',description:'四欄線性圖示',source_pages:['P.7']}
    ], pages:[
      {source_page:'P.1',layout_id:'Q',background:'dark',background_description:'深底主畫布',background_color:'#101020',text_color:'#FFFFFF',material:'立體圖像'},
      {source_page:'P.7',layout_id:'B',background:'light',background_description:'白底主畫布與細深色頁腳',background_color:'#FFFFFF',text_color:'#111111',material:'線性圖示'}
    ] } };
}
test('compiler preserves both scopes and assigns the same IDs in all prompt modes',()=>{
  const {profile,context}=fixture();const result=compile(profile,context);
  assert.equal(result.quality.ready,true);
  for(const p of [result.globalPrompt,result.slidePrompt]) {
    assert.match(p,/版型 A：封面/);assert.match(p,/版型 B：四欄/);
    assert.match(p,/白底主畫布/);assert.match(p,/深底主畫布/);
    assert.match(p,/標題與正文分區/);assert.match(p,/圖像主體必須換成新主題/);assert.match(p,/否則不生成 QR Code/);
  }
  profile.layouts.reverse();profile.pages.reverse();
  assert.deepEqual(compile(profile,context),result);
});
test('missing, extra and duplicate pages prevent export',()=>{
  for(const mutate of [p=>p.pages.pop(),p=>p.pages.push({...p.pages[0]}),p=>p.pages.push({...p.pages[0],source_page:'P.99'})]) {
    const {profile,context}=fixture();mutate(profile);const r=compile(profile,context);
    assert.equal(r.quality.ready,false);assert.equal(r.globalPrompt,'');assert.equal(r.slidePrompt,'');
  }
});
test('unknown or mismatched layout references and duplicate IDs cannot silently pass',()=>{
  for(const mutate of [p=>p.pages[1].layout_id='Z',p=>p.pages[1].layout_id='Q',p=>p.layouts[1].id='Q']) {
    const {profile,context}=fixture();mutate(profile);assert.equal(inspect(profile,context).ready,false);
  }
});
test('bright source falsely described as dark needs correction or an explicit scoped reason',()=>{
  const {profile,context}=fixture();const p=profile.pages[1];p.background='dark';p.background_color='#111111';p.text_color='#FFFFFF';
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='pixel_conflict'));
  context.confirmations={'P.7':{reason:'大量白色商品照片，邊緣主畫布為深色',signature:JSON.stringify([p.background,p.background_description,p.background_color])}};
  assert.equal(inspect(profile,context).ready,true);
  p.background_description='改變背景描述';
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='pixel_conflict'));
});
test('missing colors, low contrast and invalid source scope cannot produce a ready result',()=>{
  const {profile,context}=fixture();profile.pages[1].text_color='#FFFFFF';
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='text_contrast'));
  profile.pages[1].text_color='red; background:url(x)';
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='page_colors'));
  assert.equal(inspect(profile,{}).ready,false);
});
test('unobserved rule references are blocked and case edits do not modify another record',()=>{
  const {profile,context}=fixture();const untouched=structuredClone(profile);
  profile.rules=[{property:'字體',value:'無襯線',scope:'全篇',source_pages:['P.30']}];
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='rule_source'));
  assert.equal(untouched.rules.length,0);
});
test('actual previous sparse model output is not considered structurally complete',()=>{
  const {profile,context}=fixture();delete profile.pages;
  const q=inspect(profile,context);assert.equal(q.ready,false);assert.equal(q.issues.filter(i=>i.code==='missing_page').length,2);
});

test('a layout cannot claim a page assigned to a different layout',()=>{
  const {profile,context}=fixture(); profile.layouts[0].source_pages.push('P.7');
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='layout_mapping'));
});
test('both modes retain observed accent colors and ignore malformed palette values',()=>{
  const {profile,context}=fixture();context.palette=[{role:'強調色',hex:'#5649EC'},{role:'bad',hex:'#FFF; color:red'}];
  const result=compile(profile,context);
  for(const prompt of [result.globalPrompt,result.slidePrompt]) {
    assert.match(prompt,/#5649EC/);assert.doesNotMatch(prompt,/color:red/);
  }
});

test('mixed backgrounds do not bypass foreground contrast validation',()=>{
  const {profile,context}=fixture();Object.assign(profile.pages[1],{background:'mixed',text_color:'#FFFFFF'});
  assert.ok(inspect(profile,context).issues.some(i=>i.code==='text_contrast'));
});

test('metadata parser respects quoted braces and escapes, skips other JSON, and rejects truncation',()=>{
  const {metadataBlocks}=require('../style-quality.js');
  const value={style_name:'brace } and " quote',palette:[],design_profile:{pages:[{value:'[}]'}]}};
  const encoded=JSON.stringify(value);
  const blocks=metadataBlocks('```JSON\n'+encoded+'\n## Evidence\n```html\n<div></div>\n```');
  assert.equal(blocks.length,1);assert.deepEqual(blocks[0].value,value);
  assert.equal(metadataBlocks('```json\n'+encoded.slice(0,-2)).length,0);
});
