import test from 'node:test';
import assert from 'node:assert/strict';
import {convert,tweetLength,fitTweet,splitThread} from './core.js';
test('retains article semantics and excludes active HTML',()=>{
 const r=convert({markdown:'# 标题\n\n## 小节\n\n**重点**\n\n> 引用\n\n- 第一项\n- 第二项\n\n```js\nconst a = 1 < 2\n```\n\n| A | B |\n|---|---|\n|1|2|\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))'});
 assert.equal(r.title,'标题');for(const tag of ['<h2>','<strong>','<blockquote>','<ul>','<pre>','<table>'])assert.ok(r.html.includes(tag),tag);assert.ok(!r.html.includes('<script>'));assert.ok(!r.html.includes('href="javascript:'));
});
test('X length uses weighted CJK, links and emoji without splitting graphemes',()=>{
 assert.equal(tweetLength('你好'),4);assert.equal(tweetLength('https://example.com/a-long-link'),23);assert.ok(tweetLength(fitTweet('中'.repeat(300)))<=280);assert.ok(tweetLength(fitTweet('👨‍👩‍👧‍👦'.repeat(200)))<=280);
});
test('generated cover and section are embedded, invalid image payload rejected',()=>{
 const r=convert({markdown:'# 示例\n\n## 小节\n正文',images:[{label:'封面',data:'data:image/png;base64,YQ=='},{label:'插图',heading:'小节',data:'data:image/png;base64,Yg=='},{data:'javascript:alert(1)'}]});assert.equal((r.html.match(/<figure>/g)||[]).length,2);assert.ok(r.html.indexOf('<figure>')<r.html.indexOf('<h2>'));assert.ok(!r.html.includes('javascript:'));
});
test('frontmatter title and empty file',()=>{assert.equal(convert({markdown:'---\ntitle: "文稿"\n---\n正文'}).title,'文稿');assert.throws(()=>convert({markdown:' '}));});
test('thread preserves full text, links and graphemes within every post limit',()=>{
 const text='标题\n\n'+('中文句子。👨‍👩‍👧‍👦 https://example.com/'+ 'long-path/'.repeat(10)+'\n').repeat(50);
 const posts=splitThread(text);assert.ok(posts.length>1);assert.ok(posts.every(p=>tweetLength(p)<=280));assert.equal(posts.map(p=>p.replace(/\n\n\d+\/\d+$/,'')).join(''),text);assert.equal(posts.filter(p=>p.includes('https://example.com/')).length>0,true);
 const r=convert({markdown:'# 示例\n\n[项目](https://example.com/research)\n\n'+text});assert.ok(r.plain.includes('https://example.com/research'));assert.ok(r.thread.length>1);
});
