import {basename,extname} from 'node:path';
import {unzipSync} from 'fflate';
import {convert} from './core.js';
const MAX=15000000;
export async function importDocument({filename,base64}){
 if(typeof filename!=='string'||typeof base64!=='string'||base64.length>MAX*4/3+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('文件无效或超过 15 MB。');
 const buffer=Buffer.from(base64,'base64'),ext=extname(filename).toLowerCase(),warnings=[];
 if(!buffer.length||buffer.length>MAX)throw new Error('请选择 15 MB 以内的非空文件。');
 let markdown;
 if(ext==='.docx'){
  let expanded=0;unzipSync(buffer,{filter(file){expanded+=file.originalSize;if(expanded>60000000)throw new Error('Word 解压后超过 60 MB。');return false;}});
  const {default:mammoth}=await import('mammoth');const {default:Turndown}=await import('turndown');const {gfm}=await import('turndown-plugin-gfm');
  const result=await mammoth.convertToHtml({buffer},{externalFileAccess:false,convertImage:mammoth.images.imgElement(async image=>{
   if(!/^image\/(png|jpeg|webp)$/.test(image.contentType)){warnings.push('一张 Word 图片格式不受支持，未导入。');return {src:'',alt:'未导入的图片'};}
   const data=await image.read('base64');if(data.length>8000000*4/3){warnings.push('一张 Word 图片超过 8 MB，未导入。');return {src:'',alt:'超过大小限制的图片'};}
   return {src:`data:${image.contentType};base64,${data}`};
  })});
  const td=new Turndown({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});td.use(gfm);td.remove(['script','style','iframe','object']);markdown=td.turndown(result.value);
  warnings.push(...result.messages.map(v=>v.message));
  if(!/^#\s/m.test(markdown))markdown='# '+basename(filename,ext)+'\n\n'+markdown;
 }else if(ext==='.pdf'){
  if(buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('不是有效的 PDF 文件。');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true});let doc;
  try{
   doc=await task.promise;if(doc.numPages>100)throw new Error('PDF 超过 100 页，请分篇导入。');
   const pages=[],empty=[];
   for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n),content=await page.getTextContent();let text='',y=null;
    for(const item of content.items){if(!('str' in item))continue;const newY=item.transform?.[5];if(y!==null&&newY!==undefined&&Math.abs(y-newY)>3&&!text.endsWith('\n'))text+='\n';else if(text&&!/\s$/.test(text)&&item.str&&!/^[\p{Script=Han}，。！？、；：]/u.test(item.str)&&!/[\p{Script=Han}]$/u.test(text))text+=' ';text+=item.str;if(item.hasEOL)text+='\n';y=newY;}
    if(!text.trim())empty.push(n);else pages.push(text.trim());page.cleanup();
   }
   if(!pages.length)throw new Error('PDF 没有可提取文字，可能是扫描件。请先做 OCR，或导入 Word/Markdown。');
   if(empty.length)warnings.push('第 '+empty.join('、')+' 页没有可提取文字，可能含扫描图像，需人工核对。');
   warnings.push('PDF 按文字阅读顺序转换；复杂分栏、表格及原图暂不还原，请在预览中核对。');
   markdown='# '+basename(filename,ext)+'\n\n'+pages.join('\n\n');
  }catch(e){if(e.name==='PasswordException')throw new Error('PDF 有密码保护，请先解锁后导入。');throw e;}finally{await task.destroy();}
 }else throw new Error('支持 Markdown、Word .docx 和 PDF；旧版 .doc 请另存为 .docx。');
 if(!markdown?.trim())throw new Error('没有提取到正文。');convert({markdown,filename});
 return {markdown,filename:basename(filename,ext)+'.md',sourceFilename:basename(filename),warnings};
}
