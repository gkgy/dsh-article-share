import {readFile,writeFile,readdir,mkdir,stat,realpath} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,dirname,resolve,basename,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {convert} from './core.js';
import {importDocument} from './document-import.js';
import {openAccount,preparePublish,publishCommit,closePublisher,focusPublish,configureChrome} from './publisher.js';
const root=dirname(fileURLToPath(import.meta.url)),out=join(root,'output');
const idOK=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const imageNameOK=s=>/^[a-f0-9-]{36}-[0-2]\.png$/.test(s);
async function jobRead(id){if(!idOK(id))throw new Error('无效任务编号。');return JSON.parse(await readFile(join(out,id+'.json'),'utf8'));}
export async function operation(args){
  await mkdir(out,{recursive:true,mode:0o700});
  switch(args.action){
    case 'focus_publish':return focusPublish(args);
    case 'account':return openAccount(args.platform);
    case 'prepare_publish':return preparePublish(args);
    case 'chrome_config':throw new Error('连接文件仅限用户通过插件界面选择。');
    case 'confirm_publish':throw new Error('发布确认仅限插件界面中的用户操作，不能通过智能体工具执行。');
    case 'list':return {files:(await readdir(dirname(root))).filter(n=>/\.(md|markdown)$/i.test(n)).map(n=>({name:n,path:join(dirname(root),n)}))};
    case 'load':{
      const path=resolve(args.path||'');if(!/\.(md|markdown)$/i.test(path))throw new Error('只能读取 .md 或 .markdown 文件。');
      if((await stat(path)).size>2000000)throw new Error('Markdown 文件超过 2 MB。');
      let markdown=await readFile(path,'utf8');const warnings=[];
      // Inline local references only inside the selected article directory.
      const parent=await realpath(dirname(path));
      for(const match of [...markdown.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)]){
        const ref=match[2];if(/^(https?:|data:)/i.test(ref))continue;
        try{const file=await realpath(resolve(parent,decodeURIComponent(ref)));if(!file.startsWith(parent+sep))throw new Error('图片必须位于文章目录内');
          if(!/\.(png|jpe?g|webp)$/i.test(file)||(await stat(file)).size>8000000)throw new Error('仅支持 8 MB 以内 PNG/JPEG/WebP');
          const mime=/jpe?g$/i.test(file)?'jpeg':extname(file).slice(1).toLowerCase();const data='data:image/'+mime+';base64,'+(await readFile(file)).toString('base64');markdown=markdown.replace(match[0],`![${match[1]}](${data})`);
        }catch(e){warnings.push(ref+'：'+e.message);}
      }
      return {markdown,filename:basename(path),warnings};
    }
    case 'convert':return convert(args);
    case 'import_document':return importDocument(args);
    case 'generate':{
      if(!Array.isArray(args.prompts)||!args.prompts.length||args.prompts.length>3)throw new Error('每次请选择 1–3 张配图。');
      const prompts=args.prompts.map((p,i)=>{if(typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>5000)throw new Error('提示词需为 1–5000 字。');return {prompt:p.prompt,label:String(p.label||'配图 '+(i+1)).slice(0,100),heading:p.heading?String(p.heading).slice(0,300):null};});
      // Reject duplicate tasks before any model handoff.
      for(const f of await readdir(out)){if(!/^[a-f0-9-]{36}\.json$/.test(f))continue;const j=JSON.parse(await readFile(join(out,f),'utf8'));if(['pending','running'].includes(j.status)){let alive=false;try{if(j.pid){process.kill(j.pid,0);alive=true;}}catch{}if(alive||Date.now()-j.createdMs<15000)throw new Error('已有配图任务进行中，请等待或取消：'+j.id);}}
      const id=randomUUID(),file=join(out,id+'.json');const job={id,status:'pending',createdMs:Date.now(),createdAt:new Date().toISOString(),prompts,images:[],message:'任务已创建，准备本地生图…'};
      await writeFile(file,JSON.stringify(job),{mode:0o600});
      const fd=openSync(join(out,id+'.log'),'a',0o600);
      const child=spawn(process.env.ARTICLE_SHARE_NODE || join(homedir(),'.local','bin','node'),[join(root,'image-worker.js'),file],{detached:true,stdio:['ignore',fd,fd]});closeSync(fd);child.unref();
      return {id,status:'pending',message:job.message};
    }
    case 'reuse_images':{
      if(typeof args.title!=='string'||!args.title.trim())throw new Error('请先导入文章。');
      const jobs=[];for(const f of await readdir(out)){if(!/^[a-f0-9-]{36}\.json$/.test(f))continue;const j=JSON.parse(await readFile(join(out,f),'utf8'));if(j.status==='done'&&j.prompts?.some(p=>p.prompt.includes('《'+args.title+'》')))jobs.push(j);}
      jobs.sort((a,b)=>b.createdMs-a.createdMs);if(!jobs.length)throw new Error('本篇还没有已完成的配图，请先生成。');return operation({action:'job',id:jobs[0].id});
    }
    case 'job':{
      const job=await jobRead(args.id);const images=[];
      for(const im of job.images||[])if(imageNameOK(im.file)){const b=await readFile(join(out,im.file));images.push({...im,data:'data:image/png;base64,'+b.toString('base64')});}
      if(['pending','running'].includes(job.status)&&job.pid){try{process.kill(job.pid,0)}catch{job.status='interrupted';job.message='生图进程已退出。再次生成前会检查并恢复聊天模型；已生成的图片仍可下载。';}}
      return {...job,images};
    }
    case 'cancel':{const job=await jobRead(args.id);if(['pending','running'].includes(job.status))await writeFile(join(out,args.id+'.json.cancel'),'cancel',{mode:0o600});return {id:args.id,message:'已请求取消，正在等待生图停止和聊天模型恢复。'};}
    default:throw new Error('未知操作。');
  }
}
export const inject=['webServer','tools'];
export function apply(ctx){
  const server=ctx.get('webServer');
  ctx.effect(()=>()=>closePublisher());
  ctx.effect(()=>server.register({kind:'exact',path:'/article-share/api',handler:async(req,res)=>{
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(req.method!=='POST')return json(405,{error:'POST required'});
    const origin=req.headers.origin;
    if(origin&&origin!=='dsh-app://app'&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return json(403,{error:'Origin denied'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(415,{error:'JSON required'});
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>30000000)throw new Error('请求超过 30 MB。');}const args=JSON.parse(body);if(args.action==='chrome_config'){json(200,await configureChrome(args.value));}else if(args.action==='confirm_publish'){if(req.headers['x-article-share-user-confirm']!=='publish')throw new Error('请使用插件界面的确认发送按钮。');json(200,await publishCommit(args));}else json(200,await operation(args));}catch(e){json(400,{error:e.message||String(e)});}
  }}));
  ctx.tools.register({name:'article_share',description:'将用户指定的 Markdown 转为知乎富文本和 X 完整推文串。action:list 列出工作区 MD；load 读取 path 并内嵌相对路径图片；convert 接收 markdown；generate 接收 prompts[{label,heading?,prompt}]，本地 Qwen Image 生图期间暂时释放空闲的聊天模型并在结束后恢复；job/cancel 用 id 查询或取消。先准备完整提示词，再提交后台生图并结束当前聊天轮次。',parameters:{type:'object',properties:{action:{type:'string',enum:['list','load','convert','generate','job','cancel','account','prepare_publish','focus_publish']},platform:{type:'string',enum:['zhihu','x']},platforms:{type:'array',items:{type:'string',enum:['zhihu','x']}},imageJobId:{type:'string'},tweet:{type:'string'},xMode:{type:'string',enum:['article','thread']},xPosts:{type:'array',items:{type:'string'}},path:{type:'string'},markdown:{type:'string'},filename:{type:'string'},prompts:{},images:{},id:{type:'string'}},required:['action']},output:{schema:{},render:(_a,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:operation});
}
