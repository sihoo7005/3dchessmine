import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('account.js','utf8');
class Element {
  constructor(tag=''){this.tag=tag;this.children=[];this.hidden=false;this.listeners={};this.style={};this.textContent='';}
  setAttribute(){} append(...nodes){this.children.push(...nodes)} prepend(...nodes){this.children.unshift(...nodes)} replaceChildren(...nodes){this.children=nodes} addEventListener(name,fn){this.listeners[name]=fn}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  showModal(){this.open=true} close(){this.open=false} getBoundingClientRect(){return {left:0,right:800,top:0,bottom:600}}
}
const area=new Element(),accountSlot=new Element(),events={},calls=[],storage=new Map(),popup={},hintBalances={'1':0,'2':0},premiumStates={'1':false,'2':false};let failSave=false,failHints=false,expired=false,serverUser='1',records=[],confirmResult=true;
const window={addEventListener(name,fn){events[name]=fn},open(url){popup.url=url;return popup},dispatchEvent(event){events[event.type]?.(event)}};
const document={listeners:{},createElement:tag=>new Element(tag),getElementById:id=>id==='accountSlot'?accountSlot:area,addEventListener(name,fn){this.listeners[name]=fn}};
const fetch=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('/exchange'))return{ok:true,json:async()=>({token:'server-token-'+serverUser,name:'User',userId:serverUser})};
  if(url.endsWith('/session'))return{ok:true,json:async()=>({authenticated:true,name:'User',userId:serverUser})};
  if(url.endsWith('/hints')){if(failHints)throw new TypeError('offline');return{ok:true,json:async()=>({credits:hintBalances[serverUser],premium:premiumStates[serverUser],premiumTestAvailable:true})};}
  if(url.endsWith('/hint-start'))return{ok:true,json:async()=>({ticket:'promo-ticket'})};
  if(url.endsWith('/hint-claim'))return{ok:true,json:async()=>({credits:hintBalances[serverUser]+=3})};
  if(url.endsWith('/hint-use'))return{ok:true,json:async()=>({credits:--hintBalances[serverUser]})};
  if(url.endsWith('/premium-test')){premiumStates[serverUser]=JSON.parse(options.body).enabled;return{ok:true,json:async()=>({credits:hintBalances[serverUser],premium:premiumStates[serverUser],premiumTestAvailable:true})};}
  if(url.endsWith('/records')&&options.method==='POST'){if(expired){expired=false;return{ok:false,status:401}}if(failSave){failSave=false;return{ok:false,status:500}}return{ok:true,status:201}};
  return{ok:true,status:200,json:async()=>({records})};
};
const crypto={randomUUID:()=> 'a8ddc11e-7077-4111-9c8d-844761443756'};
const sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const backgroundTimeout=(fn,ms)=>{const id=setTimeout(fn,ms);id.unref();return id};
const context={window,document,location:{origin:'https://sihoo7005.github.io',pathname:'/3dchessmine/3d_minesweeper.html'},fetch,crypto,sessionStorage,Date,String,AbortController,setTimeout:backgroundTimeout,clearTimeout,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},confirm:()=>confirmResult,globalThis:{crypto}};
vm.runInNewContext(source,context);
await assert.rejects(window.chessmineHints.balance(),/login_required/);
assert.equal(window.chessmineHints.state(),'guest');
const panel=area.children[0],controls=accountSlot.children[0];assert.equal(controls.children[0].textContent,'로그인');
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
assert.equal(window.chessmineHints.state(),'authenticated');assert.equal(window.chessmineHints.owner(),'1');
failHints=true;await assert.rejects(window.chessmineHints.balance(),/network_unavailable/);failHints=false;
assert.equal((await window.chessmineHints.balance()).credits,0);assert.equal((await window.chessmineHints.start()).ticket,'promo-ticket');assert.equal((await window.chessmineHints.claim('promo-ticket')).credits,3);assert.equal((await window.chessmineHints.use()).credits,2);
assert.equal((await window.chessmineHints.setPremium(true)).premium,true);assert.equal((await window.chessmineHints.setPremium(false)).premium,false);
assert.equal(controls.children[0].children[0].textContent,'계정');
assert.deepEqual(controls.children[0].children[1].children.map(child=>child.textContent),['플레이 기록','로그아웃','계정 및 기록 삭제']);
controls.children[0].open=true;document.listeners.click({target:controls.children[0].children[1].children[0]});assert.equal(controls.children[0].open,true);document.listeners.click({target:area});assert.equal(controls.children[0].open,false);
const recordsDialog=panel.children.find(child=>child.tag==='dialog');await controls.children[0].children[1].children[0].listeners.click();assert.equal(recordsDialog.open,true);assert.equal(recordsDialog.children[1].textContent,'아직 저장된 기록이 없습니다.');recordsDialog.listeners.click({target:recordsDialog,clientX:400,clientY:300});assert.equal(recordsDialog.open,true);recordsDialog.listeners.click({target:recordsDialog,clientX:-1,clientY:300});assert.equal(recordsDialog.open,false);
await controls.children[0].children[1].children[0].listeners.click();recordsDialog.children[0].children[1].listeners.click();assert.equal(recordsDialog.open,false);
records=[[4,6],[5,15],[6,35],[4,7],[4,6]].map(([board_size,mine_count],i)=>({board_size,mine_count,finished_at:'2026-11-12T00:00:00Z',mode:'no-guess-color',weights:{K:i===4?8:7,R:1,B:1,Q:1,N:1},result:'won',duration_ms:1000}));await controls.children[0].children[1].children[0].listeners.click();const rows=recordsDialog.children[1].children;for(const [i,label] of ['쉬움','보통','어려움'].entries())assert.match(rows[i].textContent,new RegExp(label));for(const row of rows.slice(3))assert.doesNotMatch(row.textContent,/쉬움|보통|어려움/);recordsDialog.close();
events['chessmine:game-finished']({detail:{mode:'normal',size:3,mines:2,weights:{K:7,R:1,B:1,Q:1,N:1},result:'won',durationMs:1234}});
await new Promise(resolve=>setImmediate(resolve));
const firstPost=calls.find(call=>call.url.endsWith('/records')&&call.options.method==='POST');
assert.equal(firstPost.options.headers.Authorization,'Bearer server-token-1');assert.equal(firstPost.options.credentials,'omit');assert.equal(JSON.parse(firstPost.options.body).result,'won');
failSave=true;events['chessmine:game-finished']({detail:{mode:'normal'}});await new Promise(resolve=>setImmediate(resolve));
const retry=panel.children.find(child=>child.textContent==='기록 저장 다시 시도');assert.equal(retry.hidden,false);await retry.listeners.click();assert.equal(retry.hidden,true);
expired=true;events['chessmine:game-finished']({detail:{mode:'normal'}});await new Promise(resolve=>setImmediate(resolve));
assert.equal(controls.children[0].textContent,'로그인');
const postsBeforeAccountSwitch=calls.filter(call=>call.url.endsWith('/records')&&call.options.method==='POST').length;
serverUser='2';controls.children[0].listeners.click();const secondState=new URL(popup.url).searchParams.get('state');
await events.message({origin:'https://jsaur.duckdns.org',source:popup,data:{type:'chessmine-login',state:secondState,code:'ticket'}});
assert.equal((await window.chessmineHints.balance()).credits,0,'A second account must not inherit credits');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.filter(call=>call.url.endsWith('/records')&&call.options.method==='POST').length,postsBeforeAccountSwitch,'An unsaved record must not be sent to a different account');
const logoutButton=controls.children[0].children[1].children.find(child=>child.textContent==='로그아웃');confirmResult=false;const beforeLogout=calls.length;await logoutButton.listeners.click();assert.equal(calls.length,beforeLogout,'Cancelling logout must not call the server');assert.equal(storage.get('chessmine:session'),'server-token-2');confirmResult=true;await logoutButton.listeners.click();assert.equal(storage.has('chessmine:session'),false);assert.ok(calls.some(call=>call.url.endsWith('/logout')));
controls.children[0].listeners.click();const thirdState=new URL(popup.url).searchParams.get('state');await events.message({origin:'https://jsaur.duckdns.org',source:popup,data:{type:'chessmine-login',state:thirdState,code:'ticket'}});
const deleteButton=controls.children[0].children[1].children.find(child=>child.textContent==='계정 및 기록 삭제');await deleteButton.listeners.click();
assert.equal(storage.has('chessmine:session'),false);assert.ok(calls.some(call=>call.url.endsWith('/delete')));
console.log('Verified cross-origin login checks, record save, retry and account deletion');
