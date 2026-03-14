declare const BABYLON: any;

type Dir = 0|1|2|3;
type ProcessAction = 'walk'|'left'|'right'|'pushRock'|'jump'|'chopTree'|'collectWood'|'buildBoat'|'paddleAcross'|'offerSnack'|'enterCabin';
type DecisionAction = 'rockAhead'|'holeAhead'|'treeAhead'|'streamAhead'|'animalAhead'|'enoughWood'|'exitAhead';

type Tile = '.'|'S'|'C'|'R'|'H'|'T'|'W'|'A';

interface ProcessNode { id:string; type:'process'; action:ProcessAction; }
interface DecisionNode { id:string; type:'decision'; condition:DecisionAction; onTrue:ProcessAction|'none'; onFalse:ProcessAction|'none'; }
type FlowNode = ProcessNode|DecisionNode;

interface Level {
  name:string; instruction:string; limit:number; perfect:number;
  grid:string[];
  actions:ProcessAction[];
  decisions:DecisionAction[];
}

class CrossTheValley {
  private canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  private miniCanvas = document.getElementById('miniMap') as HTMLCanvasElement;
  private flow = document.getElementById('flow') as HTMLDivElement;
  private statusEl = document.getElementById('status') as HTMLDivElement;
  private levelEl = document.getElementById('levelLabel') as HTMLSpanElement;
  private stepEl = document.getElementById('stepLabel') as HTMLSpanElement;
  private invEl = document.getElementById('invLabel') as HTMLSpanElement;
  private limitEl = document.getElementById('limitLabel') as HTMLSpanElement;
  private starEl = document.getElementById('starLabel') as HTMLSpanElement;

  private engine:any; private scene:any; private camera:any;
  private player:any; private cabinDoor:any;
  private nodes:FlowNode[] = [];
  private runToken = 0; private running = false; private stepIdx = 0;

  private levels:Level[] = [
    {
      name:'Level 1 · Basic obstacle reactions',
      instruction:'Use Rock/Hole decisions and actions to cross, then Enter Cabin.',
      limit:6, perfect:5,
      grid:[
        'GGGGGGGG',
        'GSPRHPRC',
        'GGGGGGGG'
      ].map(r=>r.replace(/G/g,'.').replace(/P/g,'.')),
      actions:['walk','left','right','pushRock','jump','enterCabin'],
      decisions:['rockAhead','holeAhead']
    },
    {
      name:'Level 2 · Resources and streams',
      instruction:'Chop and collect wood, build boat, paddle stream, then Enter Cabin.',
      limit:8, perfect:7,
      grid:[
        '.........',
        '.S.TW...C',
        '.........'
      ],
      actions:['walk','chopTree','collectWood','buildBoat','paddleAcross','enterCabin'],
      decisions:['treeAhead','streamAhead','enoughWood']
    },
    {
      name:'Level 3 · Multi-step planning',
      instruction:'Combine resources, animal handling, hole jump, and explicit Enter Cabin.',
      limit:10, perfect:9,
      grid:[
        '...........',
        '.S.TWAW.H.C',
        '...........'
      ],
      actions:['walk','chopTree','collectWood','buildBoat','paddleAcross','offerSnack','jump','enterCabin'],
      decisions:['treeAhead','streamAhead','enoughWood','animalAhead','holeAhead','exitAhead']
    }
  ];

  private levelIndex=0;
  private pos={r:0,c:0,dir:1 as Dir};
  private start={r:0,c:0,dir:1 as Dir};
  private cabin={r:0,c:0};
  private wood=0; private hasBoat=false; private enteredCabin=false;
  private path:Array<{r:number;c:number}>=[];
  private tileMap = new Map<string,any>();

  constructor(){
    this.engine = new BABYLON.Engine(this.canvas, true);
    this.scene = this.setupScene();
    this.wireUI();
    this.loadLevel(0);
    this.engine.runRenderLoop(()=>{this.scene.render(); if (this.cabinDoor) this.cabinDoor.rotation.y += 0.005;});
    window.addEventListener('resize',()=>this.engine.resize());
  }

  private setupScene(){
    const scene = new BABYLON.Scene(this.engine);
    scene.clearColor = new BABYLON.Color4(0.74,0.88,1,1);
    const light = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0,1,0), scene); light.intensity=.9;
    const sun = new BABYLON.DirectionalLight('d', new BABYLON.Vector3(-0.6,-1,-0.4), scene); sun.position = new BABYLON.Vector3(10,22,10); sun.intensity=.6;
    this.camera = new BABYLON.FollowCamera('fc', new BABYLON.Vector3(0,6,-8), scene);
    this.camera.radius = 9; this.camera.heightOffset = 4; this.camera.rotationOffset = 180; this.camera.cameraAcceleration=.08; this.camera.maxCameraSpeed=15;
    return scene;
  }

  private loadLevel(index:number){
    this.levelIndex=index; this.runToken++; this.running=false; this.stepIdx=0; this.nodes=[];
    this.disposeDynamic();
    const lv=this.levels[index];
    this.levelEl.textContent=lv.name; this.setStatus(lv.instruction);
    this.wood=0; this.hasBoat=false; this.enteredCabin=false; this.path=[];

    const grass = this.mat('#7dcf74','#4da258');
    const dirt = this.mat('#b88954','#8c6036');
    const rockM = this.mat('#8f95a6','#677086');
    const waterM = this.mat('#59b6ff','#328fe6',true);
    const holeM = this.mat('#2e2a2f','#1d1720');
    const treeM = this.mat('#65b55d','#3f7d39');

    const g=lv.grid;
    for(let r=0;r<g.length;r++)for(let c=0;c<g[0].length;c++){
      const t = g[r][c] as Tile;
      const x=c*2,z=r*2;
      const base=BABYLON.MeshBuilder.CreateGround(`tile-${r}-${c}`,{width:2,height:2},this.scene);
      base.position.set(x,0,z);
      base.material = (t==='.'||t==='S'||t==='C')?dirt:grass;
      this.tileMap.set(`${r},${c}`, base);

      if(t==='R'){
        const rock=BABYLON.MeshBuilder.CreateSphere(`r-${r}-${c}`,{diameter:1.35},this.scene); rock.position.set(x,0.68,z); rock.material=rockM;
      } else if(t==='H'){
        const pit=BABYLON.MeshBuilder.CreateCylinder(`h-${r}-${c}`,{diameter:1.4,height:.3,tessellation:20},this.scene); pit.position.set(x,.02,z); pit.material=holeM;
      } else if(t==='T'){
        const trunk=BABYLON.MeshBuilder.CreateCylinder(`tr-${r}-${c}`,{height:1.2,diameter:.35},this.scene); trunk.position.set(x,.6,z); trunk.material=this.mat('#8b5a2b','#704120');
        const crown=BABYLON.MeshBuilder.CreateSphere(`tc-${r}-${c}`,{diameter:1.2},this.scene); crown.position.set(x,1.5,z); crown.material=treeM;
      } else if(t==='W'){
        const water=BABYLON.MeshBuilder.CreateGround(`w-${r}-${c}`,{width:2,height:2},this.scene); water.position.set(x,.04,z); water.material=waterM;
      } else if(t==='A'){
        const body=BABYLON.MeshBuilder.CreateSphere(`a-${r}-${c}`,{diameter:1.1},this.scene); body.position.set(x,.55,z); body.material=this.mat('#d18f56','#b46f35');
        const ear=BABYLON.MeshBuilder.CreateSphere(`ae-${r}-${c}`,{diameter:.35},this.scene); ear.position.set(x+.35,.95,z+.2); ear.material=body.material;
      } else if(t==='S'){
        this.start={r,c,dir:1}; this.pos={...this.start};
      } else if(t==='C'){
        this.cabin={r,c};
        this.createCabin(x,z);
      }
    }

    this.player = this.createPlayer();
    this.placePlayer(); this.camera.lockedTarget=this.player;
    this.refreshFlow(); this.updateHUD(); this.drawMini();
  }

  private createCabin(x:number,z:number){
    const base=BABYLON.MeshBuilder.CreateBox('cabin',{width:1.8,height:1.3,depth:1.8},this.scene); base.position.set(x,.65,z); base.material=this.mat('#d8a46e','#ac733e');
    const roof=BABYLON.MeshBuilder.CreateCylinder('roof',{diameterTop:0,diameterBottom:2.3,height:1.2,tessellation:4},this.scene); roof.position.set(x,1.7,z); roof.rotation.y=Math.PI/4; roof.material=this.mat('#a44334','#7e2f25');
    const door=BABYLON.MeshBuilder.CreateBox('door',{width:.45,height:.75,depth:.06},this.scene); door.position.set(x-.35,.4,z+.92); door.material=this.mat('#6f4a2b','#4b2f18');
    this.cabinDoor=door;
  }

  private createPlayer(){
    const body=BABYLON.MeshBuilder.CreateCapsule('pbody',{height:1.2,radius:.35},this.scene); body.position.y=.8; body.material=this.mat('#66c7ff','#3f98d4');
    const bag=BABYLON.MeshBuilder.CreateBox('bag',{width:.4,height:.45,depth:.2},this.scene); bag.position.set(0,.85,-.28); bag.material=this.mat('#f2c278','#d49f4a');
    const face=BABYLON.MeshBuilder.CreateSphere('face',{diameter:.16},this.scene); face.position.set(.14,1.05,.28); face.material=this.mat('#fff','#ddd');
    const root=BABYLON.Mesh.MergeMeshes([body,bag,face], true, false, undefined, false, true);
    return root;
  }

  private mat(c1:string,c2:string,alpha=false){const m=new BABYLON.StandardMaterial('m'+Math.random(),this.scene); m.diffuseColor=BABYLON.Color3.FromHexString(c1); m.emissiveColor=BABYLON.Color3.FromHexString(c2).scale(.08); if(alpha)m.alpha=.9; return m;}

  private disposeDynamic(){
    this.scene.meshes.slice().forEach((m:any)=>{ if(!['fc'].includes(m.name)) m.dispose(); });
    this.tileMap.clear();
  }

  private wireUI(){
    document.querySelectorAll<HTMLElement>('#shapeBank .shape').forEach(s=>s.addEventListener('dragstart',e=>e.dataTransfer?.setData('shape', s.dataset.shape||'process')));
    this.flow.addEventListener('dragover',e=>e.preventDefault());
    this.flow.addEventListener('drop',e=>{e.preventDefault(); const shape=e.dataTransfer?.getData('shape'); if(!shape||shape==='start')return;
      const lv=this.levels[this.levelIndex];
      if(this.nodes.length>=lv.limit){ this.setStatus('Algorithm too long. Try solving it with fewer steps.','bad'); return; }
      if(shape==='process') this.nodes.push({id:crypto.randomUUID(),type:'process',action:lv.actions[0]} as ProcessNode);
      if(shape==='decision') this.nodes.push({id:crypto.randomUUID(),type:'decision',condition:lv.decisions[0],onTrue:lv.actions[0],onFalse:'none'} as DecisionNode);
      this.refreshFlow(); this.updateHUD();
    });

    (document.getElementById('runBtn') as HTMLButtonElement).onclick=()=>this.runAll();
    (document.getElementById('stepBtn') as HTMLButtonElement).onclick=()=>this.stepThrough();
    (document.getElementById('resetBtn') as HTMLButtonElement).onclick=()=>this.reset();
    (document.getElementById('clearBtn') as HTMLButtonElement).onclick=()=>{this.nodes=[];this.refreshFlow();this.updateHUD();this.setStatus('Flowchart cleared.');};
  }

  private refreshFlow(active=''){
    const lv=this.levels[this.levelIndex]; this.flow.innerHTML='';
    this.flow.append(this.makeFixed('START','start',active==='start')); this.flow.append(this.conn());
    this.nodes.forEach((n,i)=>{ this.flow.append(this.makeNode(n,active===n.id,lv)); if(i<this.nodes.length-1)this.flow.append(this.conn()); });
    this.flow.append(this.conn()); this.flow.append(this.makeFixed('END','end',active==='end'));
  }
  private makeFixed(txt:string,id:string,active:boolean){const d=document.createElement('div');d.className=`node ${active?'active':''}`;d.innerHTML=`<span class="shape oval">${txt}</span>`;d.dataset.id=id;return d;}
  private conn(active=false){const d=document.createElement('div');d.className=`conn ${active?'active':''}`;return d;}

  private makeNode(n:FlowNode,active:boolean,lv:Level){
    const d=document.createElement('div'); d.className=`node ${active?'active':''}`; d.draggable=true; d.dataset.id=n.id;
    d.addEventListener('dragstart',e=>e.dataTransfer?.setData('move',n.id));
    d.addEventListener('dragover',e=>e.preventDefault());
    d.addEventListener('drop',e=>{e.preventDefault();const mid=e.dataTransfer?.getData('move');if(!mid||mid===n.id)return;const from=this.nodes.findIndex(x=>x.id===mid),to=this.nodes.findIndex(x=>x.id===n.id);if(from<0||to<0)return;const [p]=this.nodes.splice(from,1);this.nodes.splice(to,0,p);this.refreshFlow();});

    const drag=document.createElement('span');drag.className='drag';drag.textContent='↕';d.append(drag);
    const shape=document.createElement('span');shape.className=`shape ${n.type==='process'?'rect':'diamond'}`;shape.innerHTML=n.type==='process'?'Process':'<span>Decision</span>';d.append(shape);

    if(n.type==='process'){
      const s=document.createElement('select'); lv.actions.forEach(a=>s.add(new Option(this.actionLabel(a),a))); s.value=n.action; s.onchange=()=>n.action=s.value as ProcessAction; d.append(s);
    } else if(n.type==='decision'){
      const c=document.createElement('select'); lv.decisions.forEach(v=>c.add(new Option(this.decisionLabel(v),v))); c.value=n.condition; c.onchange=()=>n.condition=c.value as DecisionAction;
      const t=document.createElement('select'); ['none',...lv.actions].forEach(a=>t.add(new Option(`True: ${a==='none'?'Do Nothing':this.actionLabel(a as ProcessAction)}`,a))); t.value=n.onTrue; t.onchange=()=>n.onTrue=t.value as any;
      const f=document.createElement('select'); ['none',...lv.actions].forEach(a=>f.add(new Option(`False: ${a==='none'?'Do Nothing':this.actionLabel(a as ProcessAction)}`,a))); f.value=n.onFalse; f.onchange=()=>n.onFalse=f.value as any;
      d.append(c,t,f);
    }

    const del=document.createElement('button');del.textContent='✕';del.onclick=()=>{this.nodes=this.nodes.filter(x=>x.id!==n.id);this.refreshFlow();this.updateHUD();};d.append(del);
    return d;
  }

  private actionLabel(a:ProcessAction){return({walk:'Walk Forward',left:'Turn Left',right:'Turn Right',pushRock:'Push Rock',jump:'Jump',chopTree:'Chop Tree',collectWood:'Collect Wood',buildBoat:'Build Boat',paddleAcross:'Paddle Across',offerSnack:'Offer Snack',enterCabin:'Enter Cabin'} as Record<ProcessAction,string>)[a];}
  private decisionLabel(d:DecisionAction){return({rockAhead:'Rock ahead?',holeAhead:'Hole ahead?',treeAhead:'Tree ahead?',streamAhead:'Stream ahead?',animalAhead:'Animal ahead?',enoughWood:'Enough wood?',exitAhead:'Exit ahead?'} as Record<DecisionAction,string>)[d];}

  private front(){const delta=[[-1,0],[0,1],[1,0],[0,-1]][this.pos.dir]; return {r:this.pos.r+delta[0],c:this.pos.c+delta[1]};}
  private cell(r:number,c:number):Tile{const g=this.levels[this.levelIndex].grid; if(r<0||c<0||r>=g.length||c>=g[0].length)return 'R'; return g[r][c] as Tile;}
  private setCell(r:number,c:number,val:Tile){const g=this.levels[this.levelIndex].grid.map(x=>x.split('')); g[r][c]=val; this.levels[this.levelIndex].grid=g.map(x=>x.join(''));}

  private async runAll(){
    if(this.running)return; if(this.nodes.length>this.levels[this.levelIndex].limit) return this.setStatus('Algorithm too long. Try solving it with fewer steps.','bad');
    this.running=true; const token=++this.runToken;
    for(let i=this.stepIdx;i<this.nodes.length;i++){
      if(token!==this.runToken)break;
      const ok=await this.execNode(this.nodes[i],i+1,token); if(!ok)break; this.stepIdx=i+1;
    }
    this.running=false;
  }

  private async stepThrough(){ if(this.running)return; const node=this.nodes[this.stepIdx]; if(!node)return this.setStatus('No more blocks.'); this.running=true; const token=++this.runToken; const ok=await this.execNode(node,this.stepIdx+1,token); if(ok)this.stepIdx++; this.running=false; }

  private async execNode(node:FlowNode,step:number,token:number){
    this.stepEl.textContent=`Step ${step}`; this.refreshFlow(node.id);
    if(node.type==='process'){ if(!(await this.doAction(node.action,step,token))) return false; }
    if(node.type==='decision'){
      const yes=this.checkDecision(node.condition);
      this.setStatus(`${this.decisionLabel(node.condition)} ${yes?'Yes':'No'}.`);
      const action = yes ? node.onTrue : node.onFalse;
      if(action!=='none'){ if(!(await this.doAction(action as ProcessAction,step,token))) return false; }
    }
    this.validateBounds();
    return true;
  }

  private checkDecision(d:DecisionAction){
    const f=this.front(); const ahead=this.cell(f.r,f.c);
    if(d==='rockAhead') return ahead==='R';
    if(d==='holeAhead') return ahead==='H';
    if(d==='treeAhead') return ahead==='T';
    if(d==='streamAhead') return ahead==='W';
    if(d==='animalAhead') return ahead==='A';
    if(d==='enoughWood') return this.wood>0;
    if(d==='exitAhead') return ahead==='C';
    return false;
  }

  private async doAction(a:ProcessAction,step:number,token:number){
    if(token!==this.runToken) return false;
    if(a==='left'||a==='right'){
      this.pos.dir=((this.pos.dir+(a==='right'?1:3))%4) as Dir;
      await this.anim(this.player,'rotation.y',this.player.rotation.y,this.pos.dir*Math.PI/2,12); this.drawMini(); return true;
    }

    if(a==='enterCabin'){
      if(this.pos.r===this.cabin.r && this.pos.c===this.cabin.c){
        this.enteredCabin=true; await this.anim(this.cabinDoor,'rotation.y',this.cabinDoor.rotation.y,-1.3,14);
        return this.win();
      }
      return this.fail(`Algorithm failed: Enter Cabin used at wrong place (Step ${step}).`);
    }

    const f=this.front(); const ahead=this.cell(f.r,f.c);
    if(a==='walk'){
      if(ahead==='R') return this.fail(`Algorithm failed: You hit a rock at Step ${step}.`);
      if(ahead==='H') return this.fail(`Algorithm failed: You fell into a hole at Step ${step}.`);
      if(ahead==='T') return this.fail(`Algorithm failed: A tree blocks the way at Step ${step}.`);
      if(ahead==='W') return this.fail(`Algorithm failed: You stepped into a stream at Step ${step}.`);
      if(ahead==='A') return this.fail(`Algorithm failed: Animal blocks the path at Step ${step}.`);
      await this.moveTo(f.r,f.c,token);
      if(f.r===this.cabin.r&&f.c===this.cabin.c&&!this.enteredCabin) this.setStatus('Cabin reached, but the algorithm is incomplete. Add Enter Cabin.','bad');
      return true;
    }

    if(a==='pushRock'){
      if(ahead!=='R') return this.fail(`Algorithm failed: No rock to push at Step ${step}.`);
      this.setCell(f.r,f.c,'.'); await this.moveTo(f.r,f.c,token); this.setStatus('Rock pushed aside!'); return true;
    }
    if(a==='jump'){
      if(ahead!=='H') return this.fail(`Algorithm failed: Jump only works over a hole (Step ${step}).`);
      this.setCell(f.r,f.c,'.'); await this.moveTo(f.r,f.c,token,true); return true;
    }
    if(a==='chopTree'){
      if(ahead!=='T') return this.fail(`Algorithm failed: No tree ahead to chop (Step ${step}).`);
      this.setCell(f.r,f.c,'.'); this.setStatus('Chop! Tree is down.'); return true;
    }
    if(a==='collectWood'){
      if(ahead!=='.'&&ahead!=='W') return this.fail(`Algorithm failed: No wood bundle to collect (Step ${step}).`);
      this.wood++; this.updateHUD(); this.setStatus('Collected wood.'); return true;
    }
    if(a==='buildBoat'){
      if(this.wood<=0) return this.fail('Not enough wood to build a boat. Tiny raft failed!',true);
      this.hasBoat=true; this.wood--; this.updateHUD(); this.setStatus('Boat built from wood.'); return true;
    }
    if(a==='paddleAcross'){
      if(ahead!=='W') return this.fail(`Algorithm failed: No stream ahead to paddle across (Step ${step}).`);
      if(!this.hasBoat) return this.fail('Algorithm failed: Build Boat before paddling.');
      this.hasBoat=false; await this.moveTo(f.r,f.c,token,true); this.setStatus('Splish! You paddled across.'); return true;
    }
    if(a==='offerSnack'){
      if(ahead!=='A') return this.fail(`Algorithm failed: No animal ahead for snack (Step ${step}).`);
      this.setCell(f.r,f.c,'.'); this.setStatus('The animal happily moved aside 🐾'); return true;
    }

    return true;
  }

  private async moveTo(r:number,c:number,token:number,arc=false){
    const from=this.player.position.clone(); const to=new BABYLON.Vector3(c*2,.8,r*2); this.pos.r=r; this.pos.c=c; this.path.push({r,c});
    if(arc){
      await this.anim(this.player,'position.y',.8,1.4,8); if(token!==this.runToken)return; await this.anim(this.player,'position.y',1.4,.8,8);
    }
    await this.anim(this.player,'position',from,to,14); this.drawMini(); this.validateBounds();
  }

  private anim(target:any, prop:string, from:any, to:any, frames:number){ return BABYLON.Animation.CreateAndStartAnimation('a'+Math.random(),target,prop,30,frames,from,to,0); }

  private placePlayer(){this.player.position = new BABYLON.Vector3(this.pos.c*2,.8,this.pos.r*2); this.player.rotation = new BABYLON.Vector3(0,this.pos.dir*Math.PI/2,0);}

  private validateBounds(){
    const g=this.levels[this.levelIndex].grid; if(this.pos.r<0||this.pos.c<0||this.pos.r>=g.length||this.pos.c>=g[0].length){
      this.setStatus('Safety reset: character left valid bounds. Snapped back to spawn.','bad'); this.reset();
    }
  }

  private reset(){
    this.runToken++; this.running=false; this.stepIdx=0; this.wood=0; this.hasBoat=false; this.enteredCabin=false;
    this.loadLevel(this.levelIndex); // full state rebuild, safe for repeated reset
    this.setStatus('Level reset. Debug and try again.');
  }

  private win(){
    const stars=this.computeStars(); this.starEl.textContent=`⭐ ${stars}/3`; this.flow.querySelectorAll('.node').forEach(n=>n.classList.add('success'));
    this.setStatus(`Success! Cabin entered. You earned ${stars} star${stars>1?'s':''}.`,'good');
    if(this.levelIndex<this.levels.length-1) setTimeout(()=>this.loadLevel(this.levelIndex+1),1500);
    return true;
  }

  private computeStars(){
    let s=0; if(this.enteredCabin)s++; if(this.nodes.length<=this.levels[this.levelIndex].limit)s++; if(this.nodes.length<=this.levels[this.levelIndex].perfect)s++; return s;
  }

  private setStatus(msg:string,type:''|'good'|'bad'=''){this.statusEl.className=`status ${type}`.trim(); this.statusEl.textContent=msg;}

  private updateHUD(){
    const lv=this.levels[this.levelIndex];
    this.invEl.textContent=`Wood: ${this.wood}`;
    this.limitEl.textContent=`Blocks Remaining: ${Math.max(0,lv.limit-this.nodes.length)}`;
    this.starEl.textContent=`⭐ ${this.enteredCabin?this.computeStars():0}/3`;
  }

  private fail(msg:string,funny=false){
    if(funny){ this.player.scaling.y=.6; }
    this.setStatus(msg,'bad'); this.running=false; this.runToken++; this.stepIdx=0; return false;
  }

  private drawMini(){
    const ctx=this.miniCanvas.getContext('2d')!; const g=this.levels[this.levelIndex].grid; const rows=g.length, cols=g[0].length;
    ctx.clearRect(0,0,this.miniCanvas.width,this.miniCanvas.height);
    const cell=Math.min(this.miniCanvas.width/cols,this.miniCanvas.height/rows);
    const col:Record<string,string>={'.':'#c79a63','S':'#5ec8ff','C':'#ffb66b','R':'#848c9f','H':'#34303a','T':'#4ca84a','W':'#64c5ff','A':'#d89055'};
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){ctx.fillStyle=col[g[r][c]];ctx.fillRect(c*cell+1,r*cell+1,cell-2,cell-2)}
    this.path.forEach(p=>{ctx.fillStyle='rgba(255,255,255,.5)';ctx.fillRect(p.c*cell+cell*.3,p.r*cell+cell*.3,cell*.4,cell*.4)});
    ctx.fillStyle='#1f4b9b';ctx.beginPath();ctx.arc(this.pos.c*cell+cell/2,this.pos.r*cell+cell/2,cell*.24,0,Math.PI*2);ctx.fill();
    const f=this.front();ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(this.pos.c*cell+cell/2,this.pos.r*cell+cell/2);ctx.lineTo(f.c*cell+cell/2,f.r*cell+cell/2);ctx.stroke();
  }
}

new CrossTheValley();
