import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync('3d_minesweeper.html','utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const source=`let N,MINE_COUNT,cells,mines,ended;
  const PIECES=['K','R','B','Q','N'],key=(x,y,z)=>\`${'${x}'},${'${y}'},${'${z}'}\`,parse=k=>k.split(',').map(Number);
  ${section('  function pickPiece(', '  function updateWeightSummary(')}
  ${section('  function cluePositions(', '  function reveal(')}
  ${section('  function inferMoves(', '  let generationWorker=')}
  globalThis.solveBoard=(size,count,board,mineSet,directOnly=false)=>{N=size;MINE_COUNT=count;cells=board;mines=mineSet;ended=false;return inferMoves(500000,directOnly);};`;
let answer;
const context=vm.createContext({postMessage:message=>{if(message.type!=='progress')answer=message;}});
vm.runInContext(source,context);
// With no clue-connected cells, the total mine count alone can decide each cell.
for(const [mineCount,expected] of [[0,false],[1,null],[2,true]]){
  const ids=['0,0,0','2,2,2'],mineSet=new Set(ids.slice(0,mineCount));
  const board=new Map(ids.map(id=>[id,{piece:'K',revealed:false,flagged:false}]));
  const result=context.solveBoard(3,mineCount,board,mineSet);
  assert.equal(result.conflict,false);
  assert.equal(result.moves.length,expected===null?0:2);
  for(const move of result.moves)assert.equal(move.mine,expected,'Free cells must respect the remaining mine count');
}
const originalCluePositions=context.cluePositions;
context.cluePositions=()=>[[1,0,0],[0,1,0]];
const frontierIds=['1,0,0','0,1,0'],freeIds=['2,2,1','2,2,2'];
const mixedBoard=new Map([['0,0,0',{piece:'K',revealed:true,flagged:false}],...frontierIds.concat(freeIds).map(id=>[id,{piece:'K',revealed:false,flagged:false}])]);
const mixedResult=context.solveBoard(3,3,mixedBoard,new Set([frontierIds[0],...freeIds]));
assert.deepEqual([...mixedResult.moves].map(move=>move.key).sort(),freeIds.sort());
assert.ok([...mixedResult.moves].every(move=>move.mine),'Free cells must be mines when the frontier uses the other mine');
context.cluePositions=originalCluePositions;
const useDefaults=process.argv.includes('--default'),easy=process.argv.includes('--easy');
const inputValue=id=>Number(html.match(new RegExp(`id="${id}"[^>]*value="([^"]+)"`))[1]);
const size=easy?4:useDefaults?inputValue('sizeInput'):3,count=easy?6:useDefaults?inputValue('mineInput'):2;
const positions=[];for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)positions.push([x,y,z]);
const weights=Object.fromEntries(['K','R','B','Q','N'].map(piece=>[piece,Number(html.match(new RegExp(`id="weight${piece}"[^>]*value="([^"]+)"`))[1])])),choices=[];
for(const piece of Object.keys(weights))for(const pos of positions)if(pos.some(v=>v===size-1)&&context.cluePositions(pos,piece,size).length<=size**3-count-1)choices.push({piece,pos});
context.options={size,count,weights,positions,choices,hasSurface:true,directOnly:easy};
vm.runInContext('generateNoGuessBoard(options)',context,{timeout:40000});
assert.equal(answer?.type,'ready','A verified puzzle should be generated');
const mines=new Set(answer.mines),board=new Map(answer.pieces.map(([id,piece])=>[id,{piece,revealed:id===answer.openingKey,flagged:false}]));
const asKey=pos=>pos.join(','),asPos=id=>id.split(',').map(Number),range=(id,piece)=>context.cluePositions(asPos(id),piece,size).map(asKey);
assert.equal(mines.size,count);
assert.equal(mines.has(answer.openingKey),false);
assert.equal(range(answer.openingKey,board.get(answer.openingKey).piece).filter(id=>mines.has(id)).length,0);

while([...board].some(([id,c])=>!mines.has(id)&&!c.revealed)){
  const result=context.solveBoard(size,count,board,mines,easy);
  assert.equal(result.conflict,false);assert.ok(!result.limited&&result.moves.length);
  if(easy)assert.ok([...result.moves].every(move=>move.method==='direct'),'Easy boards must be solvable using one clue at a time');
  if(size===3){
    const flags=[...board].filter(([,c])=>c.flagged).map(([id])=>id),unknown=[...board].filter(([,c])=>!c.revealed&&!c.flagged).map(([id])=>id);
    const clues=[...board].filter(([,c])=>c.revealed).map(([id,c])=>{const ids=range(id,c.piece);return{ids,total:ids.filter(k=>mines.has(k)).length};});
    let solutions=0;const chosen=new Set(flags);
    function enumerate(at,left){
      if(!left){if(clues.some(({ids,total})=>ids.filter(id=>chosen.has(id)).length!==total))return;solutions++;for(const move of result.moves)assert.equal(chosen.has(move.key),move.mine,'A hinted cell must agree with every valid mine placement');return;}
      for(let i=at;i<=unknown.length-left;i++){chosen.add(unknown[i]);enumerate(i+1,left-1);chosen.delete(unknown[i]);}
    }
    enumerate(0,count-flags.length);assert.ok(solutions);
  }
  for(const move of result.moves){assert.equal(mines.has(move.key),move.mine);const cell=board.get(move.key);if(move.mine)cell.flagged=true;else cell.revealed=true;}
}
console.log(`Verified ${size}×${size}×${size} no-guess board with ${count} mines`);
