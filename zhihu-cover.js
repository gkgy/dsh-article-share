// A generated cover has its own role; a section illustration must never become one implicitly.
export const isCoverImage=image=>!!image&&!image.heading&&(image.role==='cover'||image.label==='封面');
export function coverGenerationPlan({platforms,images,prompts,selected}){
 const requireCover=platforms.includes('zhihu')&&!images.some(isCoverImage);
 if(!requireCover&&images.length)return null;
 const indices=requireCover?[0,...selected.filter(i=>i!==0)].slice(0,3):selected;
 const plan=indices.map(i=>prompts[i]).filter(Boolean);
 if(requireCover&&!plan.some(isCoverImage))throw new Error('知乎封面提示词缺失，请重新生成分享草稿。');
 return plan.length?plan:null;
}
export async function zhihuCoverSource(page){
 const image=page.locator('img[alt="封面图"]').first();
 if(!await image.count())return null;
 return image.evaluate(el=>el.complete&&el.naturalWidth>0&&/^https:\/\//.test(el.currentSrc||el.src)?el.currentSrc||el.src:null);
}
export async function prepareZhihuCover(page,file){
 if(!file)throw new Error('知乎缺少本地生成封面，请先生成封面后重新准备。');
 // This is the separate publication-settings input, not the body editor's image input.
 let input=page.locator('.UploadPicture-wrapper input[type="file"][accept*=".png"]');
 if(!await input.count()){
  const settings=page.getByRole('button',{name:'发布设置',exact:true});
  if(await settings.isVisible().catch(()=>false))await settings.click();
 }
 if(await input.count()!==1)throw new Error('知乎独立封面上传入口未找到，已保留草稿，请检查发布设置。');
 await input.setInputFiles(file);
 const image=page.locator('img[alt="封面图"]').first();
 try{
  await image.waitFor({state:'visible',timeout:60000});
  await page.waitForFunction(()=>{const el=document.querySelector('img[alt="封面图"]');return el&&el.complete&&el.naturalWidth>0&&/^https:\/\//.test(el.currentSrc||el.src);},null,{timeout:60000});
 }catch{throw new Error('知乎封面上传未完成，暂不能确认发布；请检查发布设置中的封面。');}
 const src=await zhihuCoverSource(page);
 if(!src)throw new Error('知乎封面核对失败，请重新准备。');
 return {status:'ready',src};
}
