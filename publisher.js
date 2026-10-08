import {chromium} from 'playwright-core';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {convert,tweetLength,splitThread} from './core.js';
const root=dirname(fileURLToPath(import.meta.url));
const chromePortFile=join(homedir(),'Library','Application Support','Google','Chrome','DevToolsActivePort');
const ownedPages=new Map();
const connectionFile=join(root,'output','chrome-connection.json');
let attachedBrowser=null;
const records=join(root,'output','publishing');
let browserPromise=null;
const runs=new Map();
const platformURL={zhihu:'https://zhuanlan.zhihu.com/write',x:'https://x.com/compose/post'};
export function parseChromeEndpoint(value){
 const [port,path]=value.trim().split(/\r?\n/).map(v=>v.trim());
 if(!/^\d+$/.test(port||'')||Number(port)<1||Number(port)>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path||''))throw new Error('Chrome 连接地址无效，请重新开启 Chrome 的远程调试。');
 return `ws://127.0.0.1:${port}${path}`;
}
export async function configureChrome(value){
 if(typeof value!=='string'||value.length>1024)throw new Error('请选择 Chrome 的 DevToolsActivePort 连接文件。');
 parseChromeEndpoint(value);await closePublisher();await mkdir(dirname(connectionFile),{recursive:true,mode:0o700});
 await writeFile(connectionFile,JSON.stringify({value}),{mode:0o600});
 return {message:'已保存 Chrome 连接文件，可点击连接平台。Chrome 重启后若地址变化，请重新选择文件。'};
}
async function browser(){
 if(!browserPromise)browserPromise=(async()=>{
  let endpoint;
  try{
   try{endpoint=parseChromeEndpoint(await readFile(chromePortFile,'utf8'));}
   catch(original){
    try{endpoint=parseChromeEndpoint(JSON.parse(await readFile(connectionFile,'utf8')).value);}
    catch{
     try{const res=await fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(2000)});if(!res.ok)throw original;const info=await res.json(),url=new URL(info.webSocketDebuggerUrl);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='9222'||url.protocol!=='ws:')throw original;endpoint=parseChromeEndpoint('9222\n'+url.pathname);}catch{throw original;}
    }
   }
  }
  catch(e){throw new Error(e.code==='EACCES'||e.code==='EPERM'?'macOS 阻止读取 Chrome 连接文件。请用“选择 Chrome 连接文件”授权 DevToolsActivePort；无需开放整个磁盘，也无需重新登录。':'请先在日常 Chrome 打开 chrome://inspect/#remote-debugging，开启 Allow remote debugging for this browser instance，然后允许本插件连接。无需重新登录知乎或 X。');}
  try{
   const connected=await chromium.connectOverCDP(endpoint,{timeout:30000});
   const context=connected.contexts()[0];
   if(!context){await connected.close();throw new Error('Chrome 未返回当前浏览器会话。');}
   attachedBrowser=connected;
   connected.on('disconnected',()=>{attachedBrowser=null;browserPromise=null;ownedPages.clear();});
   return context;
  }catch(e){throw new Error('未能连接现有 Chrome。请在 Chrome 中允许本插件的连接请求后重试；无需重新登录账号。');}
 })().catch(e=>{browserPromise=null;throw e;});
 return browserPromise;
}
const snapshot=run=>({id:run.id,nonce:run.nonce,status:run.status,title:run.title,platforms:run.platforms,results:run.results,message:run.message});
async function save(run){await mkdir(records,{recursive:true,mode:0o700});await writeFile(join(records,run.id+'.json'),JSON.stringify(snapshot(run),null,2),{mode:0o600});}
function selection(platforms){if(!Array.isArray(platforms)||!platforms.length||platforms.some(p=>!['zhihu','x'].includes(p)))throw new Error('请选择知乎或 X。');return [...new Set(platforms)];}
async function tab(platform){const ctx=await browser();let page=ownedPages.get(platform);if(!page||page.isClosed()){page=await ctx.newPage();ownedPages.set(platform,page);}page.setDefaultTimeout(12000);return page;}
export async function openAccount(platform){selection([platform]);const page=await tab(platform);await page.goto(platformURL[platform],{waitUntil:'domcontentloaded',timeout:45000});await page.bringToFront();return {message:'已连接日常 Chrome，正在使用现有的'+(platform==='x'?'X':'知乎')+'登录状态。',url:page.url()};}
async function waitEditor(page,platform){
 const editor=platform==='x'?page.locator('[data-testid="tweetTextarea_0"]').first():page.locator('textarea[placeholder*="标题"],input[placeholder*="标题"]').first();
 try{await editor.waitFor({state:'visible',timeout:15000})}catch{await page.bringToFront();throw new Error((platform==='x'?'X':'知乎')+'当前 Chrome 会话未显示编辑器，可能是账号未登录或站点验证。请检查已打开页面后重新准备。');}
 return editor;
}
export function xPosts(input){
 const posts=input.xPosts||splitThread(convert(input).title+'\n\n'+convert(input).plain);
 if(!Array.isArray(posts)||!posts.length||posts.length>100||posts.some(t=>typeof t!=='string'||!t.trim()||tweetLength(t)>280))throw new Error('X 推文串需为 1–100 条，每条不能超过 280 加权字数。');
 return posts;
}
async function prepareX(page,input,paths){
 const posts=xPosts(input);await waitEditor(page,'x');
 const composer=page.locator('[role="dialog"],[data-testid="sheetDialog"]').last();await composer.waitFor({state:'visible'});
 const boxes=composer.locator('[contenteditable="true"][data-testid^="tweetTextarea_"]');
 for(let i=0;i<posts.length;i++){
  if(i){await composer.getByRole('button',{name:/^(Add post|Add another post|添加帖子)$/i}).last().click();await boxes.nth(i).waitFor({state:'visible'});}
  await boxes.nth(i).fill(posts[i]);
  const group=paths.slice(i*4,i*4+4);
  if(group.length){const files=composer.locator('input[data-testid="fileInput"],input[type="file"][accept*="image"]');await files.last().setInputFiles(group);await composer.locator('[data-testid="attachments"] img,[data-testid="tweetPhoto"] img').nth(Math.min((i+1)*4,paths.length)-1).waitFor({state:'visible',timeout:60000});}
 }
 if(paths.length>posts.length*4)throw new Error('配图数超过推文串容量，请增加推文或减少配图。');
 const actual=await boxes.evaluateAll(elements=>elements.map(el=>el.innerText));if(JSON.stringify(actual)!==JSON.stringify(posts))throw new Error('X 推文串正文核对失败，已保留页面供检查。');
 await composer.locator('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]').first().waitFor({state:'visible'});
 return {status:'ready',kind:'thread',url:page.url(),text:posts.join('\n\n——\n\n'),posts,images:paths.length,account:(await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').innerText().catch(()=>''))||'请核对浏览器中的 X 账号'};
}
const articleTitleSelector='textarea[placeholder*="title" i],textarea[placeholder*="标题"],input[placeholder*="title" i],input[placeholder*="标题"],[contenteditable="true"][data-testid="articleTitle"]';
const articleBodySelector='[contenteditable="true"][data-testid="articleBody"],[contenteditable="true"].public-DraftEditor-content,[contenteditable="true"][role="textbox"]';
async function titleValue(el){return await el.evaluate(e=>'value' in e?e.value:e.innerText);}
async function articleFields(page){const title=page.locator(articleTitleSelector).first(),body=page.locator(articleBodySelector).filter({hasNot:page.locator('[data-testid="articleTitle"]')}).last();return {title,body};}
async function prepareXArticle(page,input,paths){
 const article=convert(input);let fields=await articleFields(page);
 if(!await fields.title.isVisible().catch(()=>false)){
  const write=page.getByRole('button',{name:/^(Write|Write an article|Create article|撰写|写文章|撰写文章)$/i}).first();
  if(await write.isVisible().catch(()=>false))await write.click();
 }
 fields=await articleFields(page);
 try{await fields.title.waitFor({state:'visible',timeout:15000});await fields.body.waitFor({state:'visible',timeout:10000});}
 catch{await page.bringToFront();throw new Error('当前 X 账号未显示文章编辑器。X Articles 需有对应 Premium 资格；请检查账号功能，或选择推文串。不会自动改成单条推文。');}
 await fields.title.fill(article.title);await fields.body.click();await page.keyboard.press('Meta+A');
 const html=article.html.replace(/<figure>[\s\S]*?<\/figure>/g,'').replace(/<img\b[^>]*>/gi,'');
 await fields.body.evaluate((el,{html,text})=>{const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{html,text:article.plain});
 if((await titleValue(fields.title))!==article.title)throw new Error('X 文章标题核对失败。');
 const body=await fields.body.innerText();if(!body.includes(article.plain.slice(0,20))||body.trim().length<article.plain.trim().length*.8)throw new Error('X 文章正文导入未通过核对，请检查已保留的草稿。');
 for(let i=0;i<paths.length;i++){
  const inputs=page.locator('input[type="file"][accept*="image"]');if(!await inputs.count())throw new Error('X 文章图片上传入口未找到，已保留文字草稿。');
  const before=await page.locator('img[src^="https://pbs.twimg.com/media/"]').count();await inputs.nth(i===0?0:(await inputs.count())-1).setInputFiles(paths[i]);
  const apply=page.getByRole('button',{name:/^(Apply|应用|完成)$/i}).last();if(await apply.isVisible().catch(()=>false))await apply.click();
  try{await page.waitForFunction(n=>document.querySelectorAll('img[src^="https://pbs.twimg.com/media/"]').length>n,before,{timeout:60000});}catch{throw new Error('X 文章图片上传未完成，已保留草稿。');}
 }
 return {status:'ready',kind:'article',url:page.url(),title:article.title,bodyDigest:createHash('sha256').update(await fields.body.innerText()).digest('hex'),images:paths.length,account:'请核对浏览器中的 X 账号与文章受众'};
}
async function prepareZhihu(page,input,paths){
 const title=await waitEditor(page,'zhihu');const article=convert(input);await title.fill(article.title);
 const editor=page.locator('[contenteditable="true"].public-DraftEditor-content,[contenteditable="true"].Editable,[contenteditable="true"][role="textbox"]').first();await editor.waitFor({state:'visible'});
 // The editor's own paste handler imports the sanitized rich text; no site API or cookies are extracted.
 const withoutImages=article.html.replace(/<figure>[\s\S]*?<\/figure>/g,'');
 await editor.click();await page.keyboard.press('Meta+A');
 await editor.evaluate((el,{html,text})=>{const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{html:withoutImages,text:article.plain});
 const body=await editor.innerText();if(body.trim().length<Math.min(80,article.plain.trim().length)||!body.includes(article.plain.slice(0,15)))throw new Error('知乎富文本导入未通过核对，已保留页面，请人工检查编辑器。');
 if(paths.length){
   await editor.click();await page.keyboard.press('Meta+End');
   const imageInput=page.locator('input[type="file"][accept*="image"]').last();
   const beforeImages=await editor.locator('img').count();
   if(!await imageInput.count())throw new Error('知乎图片上传控件未找到，已保留文字草稿。');
   for(const file of paths)await imageInput.setInputFiles(file);
   try{await page.waitForFunction(({selector,before})=>{const el=document.querySelector(selector);return el&&el.querySelectorAll('img').length>before},{selector:'[contenteditable="true"].public-DraftEditor-content,[contenteditable="true"].Editable,[contenteditable="true"][role="textbox"]',before:beforeImages},{timeout:60000})}catch{throw new Error('知乎配图上传未完成，已保留文字草稿。');}
 }
 return {status:'ready',url:page.url(),title:article.title,bodyDigest:createHash('sha256').update(await editor.innerText()).digest('hex'),images:paths.length,account:'请核对浏览器中的知乎账号'};
}
export async function preparePublish(input){
 const platforms=selection(input.platforms);if(input.xMode&&!['thread','article'].includes(input.xMode))throw new Error('请选择 X 文章或推文串。');const article=convert(input);let paths=[];
 if(input.imageJobId){if(!/^[a-f0-9-]{36}$/.test(input.imageJobId))throw new Error('无效配图任务。');const job=JSON.parse(await readFile(join(root,'output',input.imageJobId+'.json'),'utf8'));if(job.status!=='done')throw new Error('请等本地配图完成后再准备发布。');paths=job.images.map(im=>join(root,'output',im.file));}
 const id=randomUUID();const seen=new Set(paths.map(v=>v));
 for(const [i,m] of [...input.markdown.matchAll(/!\[[^\]]*\]\((data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+))\)/g)].entries()){
  const data=Buffer.from(m[3],'base64');if(data.length>8000000)throw new Error('原文图片超过 8 MB。');
  const key=createHash('sha256').update(data).digest('hex');if(seen.has(key))continue;seen.add(key);
  await mkdir(records,{recursive:true,mode:0o700});const file=join(records,id+'-source-'+i+'.'+m[2]);await writeFile(file,data,{mode:0o600});paths.push(file);
 }
 const run={id,nonce:randomUUID(),status:'preparing',title:article.title,platforms,results:{},pages:{},message:'正在准备发布草稿…',digest:createHash('sha256').update(JSON.stringify({markdown:input.markdown,xPosts:input.xPosts,xMode:input.xMode,platforms,paths})).digest('hex')};runs.set(id,run);await save(run);
 for(const platform of platforms){
  try{const page=await tab(platform);run.pages[platform]=page;await page.goto(platform==='x'&&input.xMode==='article'?'https://x.com/compose/articles':platformURL[platform],{waitUntil:'domcontentloaded',timeout:45000});run.results[platform]=platform==='x'?(input.xMode==='article'?await prepareXArticle(page,input,paths):await prepareX(page,input,paths)):await prepareZhihu(page,input,paths);}
  catch(e){run.results[platform]={status:'blocked',error:e.message.split('\n')[0],url:run.pages[platform]?.url()};}
  await save(run);
 }
 run.status=platforms.every(p=>run.results[p].status==='ready')?'ready':'blocked';run.message=run.status==='ready'?'内容和图片已填好。请核对平台、账号与预览，再点击确认发送。':'准备发布遇到阻碍，请按平台提示处理后重新准备。';await save(run);return snapshot(run);
}
export async function publishCommit({id,nonce}){
 const run=runs.get(id);if(!run||run.nonce!==nonce||run.status!=='ready')throw new Error('确认已失效，请重新准备并核对发布内容。');
 // Consume the confirmation once before touching any publish control. Never retry an ambiguous submission.
 run.nonce=null;run.status='publishing';await save(run);
 for(const platform of run.platforms){
   const page=run.pages[platform];try{
    if(!page||page.isClosed())throw new Error('发布窗口已关闭，请重新准备。');
    const isArticle=platform==='x'&&run.results[platform].kind==='article';
    const button=isArticle?page.getByRole('button',{name:/^(Publish|发布|发布文章)$/i}).first():platform==='x'?page.locator('[role="dialog"],[data-testid="sheetDialog"]').last().locator('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]').first():page.getByRole('button',{name:/^发布文章$|^发布$/}).first();
    await button.waitFor({state:'visible'});
    if(!await button.isEnabled())throw new Error('发布按钮不可用，请检查内容或图片上传状态。');
    if(platform==='zhihu'){const currentTitle=await page.locator('textarea[placeholder*="标题"],input[placeholder*="标题"]').first().inputValue();const text=await page.locator('[contenteditable="true"].public-DraftEditor-content,[contenteditable="true"].Editable,[contenteditable="true"][role="textbox"]').first().innerText();if(currentTitle!==run.title||createHash('sha256').update(text).digest('hex')!==run.results[platform].bodyDigest)throw new Error('知乎草稿已变动，请重新准备后确认。');}
    if(isArticle){const f=await articleFields(page);if(await titleValue(f.title)!==run.title||createHash('sha256').update(await f.body.innerText()).digest('hex')!==run.results[platform].bodyDigest)throw new Error('X 文章草稿已变动，请重新准备后确认。');}
    if(platform==='x' && !isArticle && JSON.stringify(await page.locator('[role="dialog"],[data-testid="sheetDialog"]').last().locator('[contenteditable="true"][data-testid^="tweetTextarea_"]').evaluateAll(elements=>elements.map(el=>el.innerText)))!==JSON.stringify(run.results[platform].posts))throw new Error('X 草稿已变动，请重新准备后确认。');
    const receipts=[];const pending=new Set();
    const onResponse=res=>{if(res.request().method()!=='POST'||!/\/CreateTweet(?:\?|$)/.test(res.url()))return;const task=(async()=>{try{const payload=await res.json();const item=payload?.data?.create_tweet?.tweet_results?.result;const postId=item?.rest_id||item?.tweet?.rest_id;if(res.ok()&&/^\d+$/.test(postId||''))receipts.push(postId);}catch{}})();pending.add(task);task.finally(()=>pending.delete(task));};
    if(platform==='x'&&!isArticle)page.on('response',onResponse);
    run.results[platform].status='submitting';await save(run);
    try{await button.click();}catch(e){if(platform==='x')page.off('response',onResponse);throw e;}
    if(platform==='zhihu'){
      // Zhihu may open its publication settings panel before the final public action.
      const confirm=page.getByRole('button',{name:/^确认发布$|^发布文章$/}).last();if(await confirm.isVisible().catch(()=>false))await confirm.click();
      try{await page.waitForURL(/zhuanlan\.zhihu\.com\/p\/\d+/,{timeout:30000});}catch{throw new Error('未确认知乎发布结果，请检查已打开页面；不会自动重发。');}
      run.results[platform]={...run.results[platform],status:'published',url:page.url()};
    }else if(isArticle){
      const confirm=page.getByRole('dialog').getByRole('button',{name:/^(Publish|发布|确认发布)$/i}).last();
      if(await confirm.isVisible().catch(()=>false))await confirm.click();
      try{await page.waitForURL(/x\.com\/(?:i\/article|[^/]+\/article)\/\d+(?:[/?#]|$)/,{timeout:45000});}catch{throw new Error('未确认 X 文章发布结果，请检查页面；不会自动重发。');}
      run.results[platform]={...run.results[platform],status:'published',url:page.url()};
    }else{
      try{
       const deadline=Date.now()+45000;while(receipts.length<run.results[platform].posts.length&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,200));await Promise.all([...pending]);}
       run.results[platform].urls=[...new Set(receipts)].map(id=>'https://x.com/i/web/status/'+id);
       if(new Set(receipts).size!==run.results[platform].posts.length)throw new Error('X 仅确认 '+new Set(receipts).size+'/'+run.results[platform].posts.length+' 条成功。请检查页面；不会自动重发。');
       run.results[platform]={...run.results[platform],status:'published',urls:receipts.map(id=>'https://x.com/i/web/status/'+id),url:'https://x.com/i/web/status/'+receipts[0]};
      }finally{page.off('response',onResponse);}

    }
   }catch(e){const old=run.results[platform].status;run.results[platform]={...run.results[platform],status:old==='submitting'?'unknown':'blocked',error:e.message};}
   await save(run);
 }
 run.status=run.platforms.every(p=>run.results[p].status==='published')?'published':'attention';run.message=run.status==='published'?'所选平台已发布。':'部分平台未确认发布成功，请检查各平台结果；不会自动重发。';await save(run);return snapshot(run);
}
export async function focusPublish({id,platform}){const run=runs.get(id);const page=run?.pages?.[platform];if(!page||page.isClosed())throw new Error('草稿窗口已关闭，请重新准备。');await page.bringToFront();return {message:'已打开待确认草稿。'};}
// Playwright closes only its CDP connection for an attached browser, preserving user Chrome and tabs.
export async function closePublisher(){const connected=attachedBrowser;attachedBrowser=null;browserPromise=null;ownedPages.clear();await connected?.close();}
