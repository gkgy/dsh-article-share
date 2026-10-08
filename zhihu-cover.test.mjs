import test from 'node:test';
import assert from 'node:assert/strict';
import {isCoverImage,coverGenerationPlan,prepareZhihuCover} from './zhihu-cover.js';
const prompts=[{label:'封面',heading:null,prompt:'cover'},{label:'正文配图 1',heading:'第一节',prompt:'body 1'},{label:'正文配图 2',heading:'第二节',prompt:'body 2'}];
test('Zhihu generates a dedicated cover even when only section images were selected or generated',()=>{
 for(const images of [[],[prompts[1]]]){
  const plan=coverGenerationPlan({platforms:['zhihu'],images,prompts,selected:[1,2]});
  assert.deepEqual(plan,prompts);assert.equal(isCoverImage(plan[0]),true);
 }
 assert.equal(isCoverImage({label:'封面',heading:'正文'}),false);
});
test('completed cover is reused, while X-only preparation keeps the user selection',()=>{
 assert.equal(coverGenerationPlan({platforms:['zhihu'],images:[prompts[0]],prompts,selected:[0]}),null);
 assert.deepEqual(coverGenerationPlan({platforms:['x'],images:[],prompts,selected:[1]}),[prompts[1]]);
 assert.throws(()=>coverGenerationPlan({platforms:['zhihu'],images:[],prompts:[],selected:[]}),/提示词缺失/);
});
test('cover preparation uploads through the dedicated control and rejects missing preview',async()=>{
 let uploaded,selector;
 const image={count:async()=>1,waitFor:async()=>{},evaluate:async()=> 'https://pic.zhimg.com/cover.png'};
 const input={count:async()=>1,setInputFiles:async file=>{uploaded=file}};
 const page={locator:s=>{if(s.startsWith('.UploadPicture')){selector=s;return input;}return {first:()=>image}},waitForFunction:async()=>{}};
 assert.deepEqual(await prepareZhihuCover(page,'cover.png'),{status:'ready',src:'https://pic.zhimg.com/cover.png'});
 assert.equal(uploaded,'cover.png');assert.match(selector,/UploadPicture-wrapper/);
 await assert.rejects(()=>prepareZhihuCover(page,null),/缺少本地生成封面/);
 image.waitFor=async()=>{throw Error('upload failed')};
 await assert.rejects(()=>prepareZhihuCover(page,'cover.png'),/封面上传未完成/);
});
