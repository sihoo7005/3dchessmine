import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('account.js','utf8');
class Element {
  constructor(tag=''){this.tag=tag;this.children=[];this.hidden=false;this.listeners={};this.style={};this.textContent='';}
  setAttribute(){} append(...nodes){this.children.push(...nodes)} prepend(...nodes){this.children.unshift(...nodes)} replaceChildren(...nodes){this.children=nodes} addEventListener(name,fn){this.listeners[name]=fn}
}
const area=new Element(),events={},calls=[],storage=new Map(),popup={};let failSave=false,expired=false,serverUser='1';
const window={addEventListener(name,fn){events[name]=fn},open(url){popup.url=url;return popup}};
const document={createElement:tag=>new Element(tag),getElementById:()=>area};
const fetch=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('/exchange'))return{ok:true,json:async()=>({token:'server-token-'+serverUser,name:'User',userId:serverUser})};
  if(url.endsWith('/session'))return{ok:true,json:async()=>({authenticated:true,name:'User',userId:serverUser})};
  if(url.endsWith('/records')&&options.method==='POST'){if(expired){expired=false;return{ok:false,status:401}}if(failSave){failSave=false;return{ok:false,status:500}}return{ok:true,status:201}};
  return{ok:true,status:200,json:async()=>({records:[]})};
};
const crypto={randomUUID:()=> 'a8ddc11e-7077-4111-9c8d-844761443756'};
const sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const context={window,document,location:{origin:'https://sihoo7005.github.io',pathname:'/3dchessmine/3d_minesweeper.html'},fetch,crypto,sessionStorage,Date,String,confirm:()=>true,globalThis:{crypto}};
vm.runInNewContext(source,context);
const panel=area.children[0],controls=panel.children[0];assert.equal(controls.children[0].textContent,'Google로 로그인');
controls.children[0].listeners.click();
const loginState=new URL(popup.url).searchParams.get('state');assert.ok(loginState);
const before=calls.length;await events.message({origin:'https://attacker.example',source:popup,data:{type:'chessmine-login',state:loginState,code:'fake'}});
assert.equal(calls.length,before,'Messages from other origins must be ignored');
await events.message({origin:'https://jsaur.duckdns.org',source:{},data:{type:'chessmine-login',state:loginState,code:'fake'}});
assert.equal(calls.length,before,'Messages from other windows must be ignored');
await events.message({origin:'https://jsaur.duckdns.org',source:popup,data:{type:'chessmine-login',state:'wrong',code:'fake'}});
assert.equal(calls.length,before,'Messages with a mismatched login state must be ignored');
await events.message({origin:'https://jsaur.duckdns.org',source:popup,data:{type:'chessmine-login',state:loginState,code:'ticket'}});
assert.equal(storage.get('chessmine:session'),'server-token-1');
assert.equal(controls.children[0].textContent,'User님');
events['chessmine:game-finished']({detail:{mode:'normal',size:3,mines:2,weights:{K:7,R:1,B:1,Q:1,N:1},result:'won',durationMs:1234}});
await new Promise(resolve=>setImmediate(resolve));
const firstPost=calls.find(call=>call.url.endsWith('/records')&&call.options.method==='POST');
assert.equal(firstPost.options.headers.Authorization,'Bearer server-token-1');assert.equal(firstPost.options.credentials,'omit');assert.equal(JSON.parse(firstPost.options.body).result,'won');
failSave=true;events['chessmine:game-finished']({detail:{mode:'normal'}});await new Promise(resolve=>setImmediate(resolve));
const retry=panel.children.find(child=>child.textContent==='기록 저장 다시 시도');assert.equal(retry.hidden,false);await retry.listeners.click();assert.equal(retry.hidden,true);
expired=true;events['chessmine:game-finished']({detail:{mode:'normal'}});await new Promise(resolve=>setImmediate(resolve));
assert.equal(controls.children[0].textContent,'Google로 로그인');
const postsBeforeAccountSwitch=calls.filter(call=>call.url.endsWith('/records')&&call.options.method==='POST').length;
serverUser='2';controls.children[0].listeners.click();const secondState=new URL(popup.url).searchParams.get('state');
await events.message({origin:'https://jsaur.duckdns.org',source:popup,data:{type:'chessmine-login',state:secondState,code:'ticket'}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.filter(call=>call.url.endsWith('/records')&&call.options.method==='POST').length,postsBeforeAccountSwitch,'An unsaved record must not be sent to a different account');
const deleteButton=controls.children.find(child=>child.textContent==='계정 및 기록 삭제');await deleteButton.listeners.click();
assert.equal(storage.has('chessmine:session'),false);assert.ok(calls.some(call=>call.url.endsWith('/delete')));
console.log('Verified cross-origin login checks, record save, retry and account deletion');
