import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync('3d_minesweeper.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('window.addEventListener("resize",resize);','window.__game={get state(){return {cells,mines,ended,hintKey,selectedClue,selectedClosed,clueRange,yaw,distance};},countMines,activate,tileStyle,layout2d,showHint,setFind3d(fn){find3d=fn;},setInference(fn){inferMoves=fn;},setRandom(fn){Math.random=fn;}};window.addEventListener("resize",resize);');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
function page(search){
  const ctx2d=new Proxy({}, {get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
  class Element{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.listeners={};this.classList={toggle(){},add(){},remove(){}};}
    addEventListener(name,fn){this.listeners[name]=fn;}
    click(){this.listeners.click?.({});}
    setAttribute(){} replaceChildren(option){this.value=option.value;} add(){} setPointerCapture(){} focus(){}
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
  let tick=0;const window={devicePixelRatio:1,addEventListener(){}};
  const document={getElementById:id=>elements[id],createElement:()=>new Element('canvas'),title:''};
  const globals={window,document,location:{search},URLSearchParams,URL:fakeURL,Blob:FakeBlob,Worker:FakeWorker,Option:class{constructor(text,value){this.text=text;this.value=value;}},setTimeout,clearTimeout,performance:{now:()=>tick},console:{error(){}}};
  vm.runInNewContext(script,globals);
  return{window,elements,advance(ms){tick+=ms;},get workers(){return workers;}};
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
assert.equal(newBoard.cells.get('0,0,1').revealed,false,'A single tap must not open a closed cell');
assert.equal(newPage.window.__game.state.selectedClosed,'0,0,1');
newPage.advance(451);newPage.window.__game.activate('0,0,1',false);
assert.equal(newBoard.cells.get('0,0,1').revealed,false,'Slow taps must not open a closed cell');
newPage.window.__game.activate('0,0,1',false);
assert.equal(newPage.window.__game.state.selectedClue,'0,0,1','A quick second tap must open the cell and show its range');
newPage.window.__game.activate('0,0,1',false);newPage.advance(451);newPage.window.__game.activate('0,0,1',false);
assert.equal([...newBoard.cells.values()].filter(c=>c.revealed).length,2,'Slow taps must not chord a clue');
newPage.window.__game.activate('0,0,1',false);
assert.ok([...newBoard.cells.values()].filter(c=>c.revealed).length>2,'A quick second tap on an opened zero clue must open its range');
const wrongPage=page(''),wrong=setBoard(wrongPage,['0,0,1','2,2,2']);
wrongPage.window.__game.activate('0,1,0',true);wrongPage.window.__game.activate('0,0,0',false);wrongPage.window.__game.activate('0,0,0',false);
assert.equal(wrongPage.window.__game.state.ended,true);assert.equal(wrong.cells.get('0,0,1').revealed,true,'An incorrect flag must not protect another mine');
const flatPage=page(''),flat=setBoard(flatPage,['2,2,1','2,2,2']),layout=flatPage.window.__game.layout2d();
const flatEvent={pointerId:1,button:0,clientX:layout.left+1.5*layout.s,clientY:layout.top+1.92*layout.s};
const threePage=page(''),three=setBoard(threePage,['2,2,1','2,2,2']);threePage.window.__game.setFind3d(()=> '1,1,0');
const threeEvent={pointerId:2,button:0,clientX:400,clientY:300};
flatPage.window.__game.activate('1,1,0',false);threePage.window.__game.activate('1,1,0',false);
flatPage.elements.board.listeners.pointerdown(flatEvent);threePage.elements.board3d.listeners.pointerdown(threeEvent);
await new Promise(resolve=>setTimeout(resolve,550));
flatPage.elements.board.listeners.pointerup(flatEvent);threePage.elements.board3d.listeners.pointerup(threeEvent);
for(const s of [flat,three]){assert.equal(s.cells.get('1,1,0').flagged,true,'A long press must toggle a flag');assert.equal(s.cells.get('1,1,0').revealed,false,'Releasing a long press must not open the cell');}
const dragPage=page(''),drag=setBoard(dragPage,['2,2,1','2,2,2']);dragPage.window.__game.setFind3d(()=> '1,1,0');
dragPage.elements.board3d.listeners.pointerdown(threeEvent);dragPage.elements.board3d.listeners.pointermove({...threeEvent,clientX:420});
const flatDragPage=page(''),flatDrag=setBoard(flatDragPage,['2,2,1','2,2,2']);
flatDragPage.elements.board.listeners.pointerdown(flatEvent);flatDragPage.elements.board.listeners.pointermove({...flatEvent,clientX:flatEvent.clientX+20});
const pinchPage=page(''),pinch=setBoard(pinchPage,['2,2,1','2,2,2']);pinchPage.window.__game.setFind3d(()=> '1,1,0');
const beforeDistance=pinchPage.window.__game.state.distance,secondFinger={...threeEvent,pointerId:3,clientX:440};
pinchPage.elements.board3d.listeners.pointerdown(threeEvent);pinchPage.elements.board3d.listeners.pointerdown(secondFinger);
pinchPage.elements.board3d.listeners.pointermove({...secondFinger,clientX:480});
await new Promise(resolve=>setTimeout(resolve,550));dragPage.elements.board3d.listeners.pointerup({...threeEvent,clientX:420});
flatDragPage.elements.board.listeners.pointerup({...flatEvent,clientX:flatEvent.clientX+20});
pinchPage.elements.board3d.listeners.pointerup({...secondFinger,clientX:480});pinchPage.elements.board3d.listeners.pointerup(threeEvent);
assert.equal(drag.cells.get('1,1,0').flagged,false,'Dragging must cancel the long press');assert.notEqual(dragPage.window.__game.state.yaw,.72);
assert.equal(flatDrag.cells.get('1,1,0').flagged,false,'Moving in 2D must cancel the long press');
assert.equal(pinch.cells.get('1,1,0').flagged,false,'Pinching must cancel the long press');assert.ok(pinchPage.window.__game.state.distance<beforeDistance);
const hintPage=page(''),hintBoard=setBoard(hintPage,['0,0,1','2,2,2']),hintApp=hintPage.window.__game,hintCell='0,0,1';
hintApp.setInference(()=>({moves:[{key:hintCell,mine:true}],conflict:false}));hintApp.showHint();
const mineStyle=JSON.stringify(hintApp.tileStyle(hintCell,hintBoard.cells.get(hintCell))),mineMessage=hintPage.elements.cellInfo.textContent;
hintApp.setInference(()=>({moves:[{key:hintCell,mine:false}],conflict:false}));hintApp.showHint();
assert.equal(JSON.stringify(hintApp.tileStyle(hintCell,hintBoard.cells.get(hintCell))),mineStyle,'Mine and safe hints must look identical');
assert.equal(hintPage.elements.cellInfo.textContent,mineMessage,'Mine and safe hints must use the same message');
assert.doesNotMatch(mineMessage,/지뢰|안전|깃발/);
hintApp.setRandom(()=>.9);hintApp.setInference(()=>({moves:[{key:hintCell,mine:true},{key:'1,1,0',mine:false}],conflict:false}));hintApp.showHint();
assert.equal(hintApp.state.hintKey,hintCell,'Hints must not prefer safe cells over mines');
console.log('Verified both modes, fast double taps, long-press flags, and drag cancellation');
