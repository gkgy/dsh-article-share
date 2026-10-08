import MarkdownIt from 'markdown-it';
import twitterText from 'twitter-text';
const md = new MarkdownIt({html:false,linkify:true,typographer:false,breaks:false});
export const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const tweetLength = text => twitterText.parseTweet(String(text)).weightedLength;
export function fitTweet(text, limit=280){
  if(tweetLength(text)<=limit)return text;
  let out='';
  for(const {segment} of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)){
    if(tweetLength(out+segment+'…')>limit)break;
    out+=segment;
  }
  return out.trimEnd()+'…';
}
export function plain(text){
 const lines=[];
 for(const t of md.parse(text,{})){
  if(t.type==='fence'||t.type==='code_block')lines.push(t.content.trimEnd());
  else if(t.type==='inline'){
   let out='',link=null;
   for(const c of t.children||[]){
    if(c.type==='link_open')link={href:c.attrGet('href'),start:out.length};
    else if(c.type==='link_close'){if(link&&out.slice(link.start)!==link.href)out+=' ('+link.href+')';link=null;}
    else if(!['image','html_inline'].includes(c.type))out+=c.content||(['softbreak','hardbreak'].includes(c.type)?'\n':'');
   }
   lines.push(out);
  }
 }
 return lines.join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
}
// Split at sentence/paragraph boundaries, keeping URLs and grapheme clusters whole.
export function splitThread(text,limit=280){
 if(typeof text!=='string'||!text.trim())throw new Error('X 推文串正文不能为空。');
 const units=[];let cursor=0;
 for(const link of twitterText.extractUrlsWithIndices(text)){
  units.push(...Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text.slice(cursor,link.indices[0])),v=>v.segment),link.url);cursor=link.indices[1];
 }
 units.push(...Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text.slice(cursor)),v=>v.segment));
 function pack(budget){const parts=[];let start=0;while(start<units.length){let end=start,chunk='',boundary=-1;while(end<units.length&&tweetLength(chunk+units[end])<=budget){chunk+=units[end];if(/[。！？.!?;；\n]$/.test(units[end]))boundary=end+1;end++;}if(end===start)throw new Error('X 正文含无法放入单条的内容。');if(end<units.length&&boundary>start&&boundary-start>(end-start)/2)end=boundary;parts.push(units.slice(start,end).join(''));start=end;}return parts;}
 let parts=pack(limit-16);
 for(let i=0;i<5;i++){const budget=limit-(`\n\n${parts.length}/${parts.length}`).length;const next=pack(budget);if(next.length===parts.length){parts=next;break;}parts=next;}
 return parts.map((part,i)=>part+`\n\n${i+1}/${parts.length}`);
}
function inlinePlain(text){return (md.parseInline(text,{})[0]?.children||[]).filter(c=>c.type!=='image').map(c=>c.content||'').join('').trim();}
export function convert({markdown,filename='文章.md',images=[]}){
  if(typeof markdown!=='string'||!markdown.trim())throw new Error('请选择非空 Markdown 文件或粘贴正文。');
  if(markdown.length>20000000)throw new Error('文章及内嵌图片超过 20 MB，请分篇转换。');
  let source=markdown.replace(/^\uFEFF/,'');let frontTitle='';
  source=source.replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/,(_,front)=>{frontTitle=front.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]||'';return '';});
  const heading=source.match(/^#\s+(.+)$/m);
  const title=inlinePlain(frontTitle||heading?.[1]||filename.replace(/\.(md|markdown)$/i,''));
  const body=heading?source.replace(heading[0],'').trim():source;
  const text=plain(body);
  const summary=text.split(/\n/).filter(l=>l.length>60)[0]||text.split('\n')[0]||title;
  const tweet=fitTweet(`${title}\n\n${summary}`);
  const headings=[...body.matchAll(/^##\s+(.+)$/gm)].map(m=>inlinePlain(m[1]));
  const sectionNames=[title,...headings.filter(h=>!/最后|建议/.test(h)).slice(0,2)];
  const prompts=sectionNames.map((name,i)=>({label:i?'正文配图 '+i:'封面',heading:i?name:null,prompt:`为中文文章《${title}》绘制${i?'正文插图':'封面插画'}。主题：${name}。文章语境：${summary.slice(0,240)}。用具体场景和物件表达内容，专业杂志编辑插画，简洁构图，层次清楚，柔和光线，蓝绿与暖白配色，画面统一，适合科技知识分享。不要文字、字母、标志、水印，不要虚构软件截图。`}));
  let html=md.render(body),warnings=[];
  // Inline all known generated/local images; never interpolate unsanitized HTML.
  for(const im of images){
    if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(im.data||''))continue;
    const figure=`<figure><img src="${im.data}" alt="${escapeHTML(im.label||title)}" style="max-width:100%;height:auto"/><figcaption>${escapeHTML(im.label||'AI 生成配图')}</figcaption></figure>`;
    if(im.heading){const target=`<h2>${md.renderInline(im.heading)}</h2>`;html=html.includes(target)?html.replace(target,target+'\n'+figure):html+'\n'+figure;}
    else html=figure+'\n'+html;
  }
  if(/<img\b[^>]*src="(?!https?:|data:)/i.test(html))warnings.push('文章含本地相对路径图片：请用“附加原文图片”选择这些文件，或在知乎上传。');
  if(/<img\b[^>]*src="https?:/i.test(html))warnings.push('原文网络图片保留链接；知乎若未自动转存，请下载后上传。');
  if(/\$[^$]+\$/.test(body))warnings.push('公式保留原文，请在知乎编辑器核对公式显示。');
  const document=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHTML(title)}</title><body><h1>${escapeHTML(title)}</h1>${html}</body></html>`;
  return {title,html,document,thread:splitThread(title+'\n\n'+text),tweet,weightedLength:tweetLength(tweet),prompts,warnings,plain:text,markdown:source};
}
