import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync('3d_minesweeper.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('window.addEventListener("resize",resize);','window.__game={get state(){return {cells,mines,ended,selectedClue,clueRange};},countMines,activate,tileStyle};window.addEventListener("resize",resize);');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
function page(search){
  const ctx2d=new Proxy({}, {get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
  class Element{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.listeners={};this.classList={toggle(){},add(){},remove(){}};}
    addEventListener(name,fn){this.listeners[name]=fn;}
    click(){this.listeners.click?.({});}
    setAttribute(){} replaceChildren(option){this.value=option.value;} add(){}
    getContext(kind){return kind==='2d'?ctx2d:null;} getBoundingClientRect(){return{width:800,height:600,left:0,top:0};}
  }
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  elements.sizeInput.value='3';elements.mineInput.value='2';elements.spacing.value='1.3';elements.layer.value='all';
  for(const piece of ['K','R','B','Q','N'])elements['weight'+piece].value='1';
  const urls=new Map();let nextUrl=0,workers=0;
  class FakeBlob{constructor(parts){this.text=parts.join('');}}
  const fakeURL={createObjectURL(blob){const id=String(++nextUrl);urls.set(id,blob.text);return id;},revokeObjectURL(id){urls.delete(id);}};
  class FakeWorker{
    constructor(url){this.source=urls.get(url);this.terminated=false;workers++;}
    terminate(){this.terminated=true;}
    postMessage(data){setTimeout(()=>{if(this.terminated)return;const worker={postMessage:message=>{if(!this.terminated)this.onmessage?.({data:message});}};try{vm.runInNewContext(this.source,worker);worker.onmessage({data});}catch(error){this.onerror?.(error);}},0);}
  }
  const window={devicePixelRatio:1,addEventListener(){}};
  const document={getElementById:id=>elements[id],createElement:()=>new Element('canvas'),title:''};
  const globals={window,document,location:{search},URLSearchParams,URL:fakeURL,Blob:FakeBlob,Worker:FakeWorker,Option:class{constructor(text,value){this.text=text;this.value=value;}},setTimeout,clearTimeout,console:{error(){}}};
  vm.runInNewContext(script,globals);
  return{window,elements,get workers(){return workers;}};
}

const original=page('');
assert.equal(original.workers,0);assert.equal(original.window.__game.state.cells.size,27);
const game=page('?mode=no-guess');
assert.equal(game.elements.start.disabled,true);assert.equal(game.window.__game.state.cells.size,0);
for(let i=0;i<100&&game.elements.start.disabled;i++)await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(game.elements.start.disabled,false);assert.match(game.elements.boardInfo.textContent,/추측 없이/);
const state=game.window.__game.state,opened=[...state.cells].filter(([,cell])=>cell.revealed);
assert.equal(state.cells.size,27);assert.equal(opened.length,1);assert.equal(state.mines.size,2);
assert.equal(game.window.__game.countMines(opened[0][0].split(',').map(Number),opened[0][1].piece),0);
game.elements.start.click();game.elements.cancelGeneration.click();
assert.equal(game.elements.start.disabled,false);assert.match(game.elements.message.textContent,/취소/);
assert.equal(game.window.__game.state.cells,state.cells);
function setBoard(p,mineIds){const s=p.window.__game.state;for(const cell of s.cells.values()){cell.revealed=false;cell.flagged=false;cell.piece='K';}s.mines.clear();for(const id of mineIds)s.mines.add(id);s.cells.get('0,0,0').revealed=true;return s;}
for(const p of [original,game]){
  const s=setBoard(p,['0,0,1','2,2,2']),app=p.window.__game,clue='0,0,0',target='0,1,0';
  app.activate(clue,false);
  assert.equal(app.state.clueRange.size,7);assert.ok(app.state.clueRange.has('0,0,1'));assert.equal(app.tileStyle(target,s.cells.get(target)).fill,'#438c80');
  assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'Selecting a clue must not open its range');
  app.activate(clue,false);
  assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'A different flag count must not open cells');
  app.activate('0,0,1',true);app.activate(clue,false);app.activate(clue,false);
  assert.equal([...s.cells.values()].filter(c=>c.revealed).length,7,'A matching flag count must open the six remaining neighbors');
  assert.equal(s.cells.get('0,0,1').flagged,true);assert.equal(s.cells.get('2,2,2').revealed,false);
}
const zeroPage=page(''),zero=setBoard(zeroPage,['2,2,1','2,2,2']);
zeroPage.window.__game.activate('0,0,0',false);zeroPage.window.__game.activate('0,0,0',false);
assert.equal([...zero.cells.values()].filter(c=>c.revealed).length,8,'A zero clue must open its entire unflagged range');
const newPage=page(''),newBoard=setBoard(newPage,['2,2,1','2,2,2']);
newPage.window.__game.activate('0,0,1',false);
assert.equal(newPage.window.__game.state.selectedClue,'0,0,1','Opening a closed cell must show its range immediately');
newPage.window.__game.activate('0,0,1',false);
assert.ok([...newBoard.cells.values()].filter(c=>c.revealed).length>2,'A second click on a newly opened zero clue must open its range');
const wrongPage=page(''),wrong=setBoard(wrongPage,['0,0,1','2,2,2']);
wrongPage.window.__game.activate('0,1,0',true);wrongPage.window.__game.activate('0,0,0',false);wrongPage.window.__game.activate('0,0,0',false);
assert.equal(wrongPage.window.__game.state.ended,true);assert.equal(wrong.cells.get('0,0,1').revealed,true,'An incorrect flag must not protect another mine');
console.log('Verified both modes, range highlighting, chord opening, and cancellation');
