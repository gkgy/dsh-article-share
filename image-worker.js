import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runMediaJob,MEDIA_DEFAULTS,splashStatus} from '../media-scheduler/media-runner.js';
import {MediaMutex} from '../media-scheduler/media-mutex.js';
import {recoverMedia} from '../media-scheduler/startup-recovery.js';
const root=dirname(fileURLToPath(import.meta.url));
const jobFile=process.argv[2];
const job=JSON.parse(await readFile(jobFile,'utf8'));
const stateDir=join(root,'output','recovery');
const comfyUrl='http://127.0.0.1:8188';
const cfg={...MEDIA_DEFAULTS,comfyUrl,stateDir,workflowDir:join(root,'..','media-scheduler'),clientId:'article-share-'+job.id};
const mutex=new MediaMutex(join(process.env.HOME,'.dsh','media-scheduler','mutex'),{timeoutMs:1000});
let saves=Promise.resolve();
const save=()=>{const snapshot=JSON.stringify(job,null,2);saves=saves.then(async()=>{await writeFile(jobFile+'.tmp',snapshot,{mode:0o600});await rename(jobFile+'.tmp',jobFile);});return saves;};
let cancelled=false;
async function cancelCheck(){try{await readFile(jobFile+'.cancel');cancelled=true;}catch{}}
const timer=setInterval(cancelCheck,1000);timer.unref();
const log=async message=>{job.message=message;job.logs=[...(job.logs||[]),message].slice(-40);await save();console.error(message);};
try{
  await mutex.acquire();
  await mkdir(stateDir,{recursive:true});
  job.status='running';job.pid=process.pid;await log('正在检查本地生图服务与内存…');
  const probe=async()=>{try{return (await fetch(comfyUrl+'/system_stats',{signal:AbortSignal.timeout(2000)})).ok}catch{return false}};
  if(!await probe()){
    await log('正在启动 ComfyUI（仅启动服务，尚未加载模型）…');
    const child=spawn('/bin/zsh',[process.env.ARTICLE_SHARE_QWEN_START || join(homedir(),'AI','Qwen-Image-Studio','start.sh')],{detached:true,stdio:'ignore'});child.unref();
    const deadline=Date.now()+90000;while(!await probe()){if(Date.now()>deadline)throw new Error('ComfyUI 启动超时，请检查本地生图服务。');await new Promise(r=>setTimeout(r,1000));}
  }
  // Repair only this plugin's own unfinished render before admitting another job.
  const rec=await recoverMedia({...cfg,log:m=>console.error(m)});
  if(rec.marker && rec.splash!=='already-up' && !rec.restored)throw new Error('上次生图恢复未完成：'+JSON.stringify(rec));
  for(let i=0;i<job.prompts.length;i++){
    await cancelCheck();if(cancelled)break;
    const idleDeadline=Date.now()+120000;let lastWait=0;
    while(true){await cancelCheck();if(cancelled)break;let up=false;try{up=(await fetch(cfg.splashUrl+'/health',{signal:AbortSignal.timeout(2000)})).ok}catch{}if(!up)break;const st=await splashStatus(cfg);if(!st.ok)throw new Error('无法确认聊天模型空闲：'+st.reason);if(st.idle)break;if(Date.now()>idleDeadline)throw new Error('聊天模型持续忙碌，请等当前聊天结束后重试。');if(Date.now()-lastWait>15000){await log('等待当前聊天结束，暂未停止聊天模型。');lastWait=Date.now();}await new Promise(r=>setTimeout(r,1000));}
    if(cancelled)break;
    await log(`正在生成 ${i+1}/${job.prompts.length}：${job.prompts[i].label}。生图期间聊天模型暂时释放，完成后恢复。`);
    const result=await runMediaJob({id:job.id+'_'+i,type:'image',params:{prompt:job.prompts[i].prompt}}, {isCancelled:()=>cancelled,log:e=>{void log(e.message)}},cfg);
    for(const path of result.outputs){const name=`${job.id}-${i}.png`;await copyFile(path,join(root,'output',name));job.images.push({...job.prompts[i],file:name,source:path});}
    await save();
  }
  job.status=cancelled?'cancelled':'done';job.message=cancelled?'已取消，聊天模型已恢复。':'配图已生成，聊天模型已恢复。';
}catch(e){job.status=cancelled?'cancelled':'failed';job.message=String(e.message||e);job.error=job.message;}
finally{clearInterval(timer);job.finishedAt=new Date().toISOString();await save();if(mutex.held)await mutex.release();}
