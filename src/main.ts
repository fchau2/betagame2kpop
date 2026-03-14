declare const BABYLON: any;

type Dir = 0 | 1 | 2 | 3;
type ProcessAction =
  | 'walk'
  | 'left'
  | 'right'
  | 'pushRock'
  | 'jump'
  | 'chopTree'
  | 'collectWood'
  | 'buildBoat'
  | 'paddleAcross'
  | 'offerSnack'
  | 'enterCabin';
type DecisionAction = 'rockAhead' | 'holeAhead' | 'treeAhead' | 'streamAhead' | 'animalAhead' | 'enoughWood' | 'exitAhead';
type Tile = '.' | 'S' | 'C' | 'R' | 'H' | 'T' | 'W' | 'A';

interface ProcessNode {
  id: string;
  type: 'process';
  action: ProcessAction;
}
interface DecisionNode {
  id: string;
  type: 'decision';
  condition: DecisionAction;
  onTrue: ProcessAction | 'none';
  onFalse: ProcessAction | 'none';
}
type FlowNode = ProcessNode | DecisionNode;

interface Level {
  name: string;
  instruction: string;
  limit: number;
  perfect: number;
  grid: string[];
  actions: ProcessAction[];
  decisions: DecisionAction[];
}

interface ExecResult {
  ok: boolean;
  message?: string;
  friendly?: boolean;
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

  private engine: any;
  private scene: any;
  private camera: any;
  private player: any;
  private cabinDoor: any;

  private nodes: FlowNode[] = [];
  private runnerToken = 0;
  private runMode: 'idle' | 'running' | 'stepping' | 'failed' | 'success' = 'idle';
  private pointer = 0;
  private highlightErrorNode = '';
  private highlightBranch: '' | 'true' | 'false' = '';

  private levelIndex = 0;
  private levelTemplate: string[] = [];
  private pos = { r: 0, c: 0, dir: 1 as Dir };
  private start = { r: 0, c: 0, dir: 1 as Dir };
  private cabin = { r: 0, c: 0 };
  private wood = 0;
  private hasBoat = false;
  private enteredCabin = false;
  private traveled: Array<{ r: number; c: number }> = [];

  private readonly levels: Level[] = [
    {
      name: 'Level 1 · Basic obstacle reactions',
      instruction: 'Use Rock/Hole decisions and actions to cross, then Enter Cabin.',
      limit: 6,
      perfect: 5,
      grid: ['........', '.S.R.H.C', '........'],
      actions: ['walk', 'left', 'right', 'pushRock', 'jump', 'enterCabin'],
      decisions: ['rockAhead', 'holeAhead']
    },
    {
      name: 'Level 2 · Resources and streams',
      instruction: 'Chop and collect wood, build boat, paddle stream, then Enter Cabin.',
      limit: 8,
      perfect: 7,
      grid: ['.........', '.S.TW...C', '.........'],
      actions: ['walk', 'chopTree', 'collectWood', 'buildBoat', 'paddleAcross', 'enterCabin'],
      decisions: ['treeAhead', 'streamAhead', 'enoughWood']
    },
    {
      name: 'Level 3 · Multi-step planning',
      instruction: 'Combine resources, animal handling, hole jump, and explicit Enter Cabin.',
      limit: 10,
      perfect: 9,
      grid: ['...........', '.S.TWAW.H.C', '...........'],
      actions: ['walk', 'chopTree', 'collectWood', 'buildBoat', 'paddleAcross', 'offerSnack', 'jump', 'enterCabin'],
      decisions: ['treeAhead', 'streamAhead', 'enoughWood', 'animalAhead', 'holeAhead', 'exitAhead']
    }
  ];

  constructor() {
    this.engine = new BABYLON.Engine(this.canvas, true);
    this.scene = this.buildScene();
    this.wireUI();
    this.loadLevel(0, true);
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', () => this.engine.resize());
  }

  private buildScene() {
    const scene = new BABYLON.Scene(this.engine);
    scene.clearColor = new BABYLON.Color4(0.72, 0.86, 1, 1);

    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.85;
    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.6, -1, -0.2), scene);
    sun.position = new BABYLON.Vector3(12, 24, -4);
    sun.intensity = 0.75;

    this.camera = new BABYLON.FollowCamera('follow', new BABYLON.Vector3(0, 6, -8), scene);
    this.camera.radius = 10;
    this.camera.heightOffset = 4.6;
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = 0.06;
    this.camera.maxCameraSpeed = 12;

    return scene;
  }

  private wireUI() {
    document.querySelectorAll<HTMLElement>('#shapeBank .shape').forEach((shape) => {
      shape.addEventListener('dragstart', (e) => e.dataTransfer?.setData('shape', shape.dataset.shape || 'process'));
    });

    this.flow.addEventListener('dragover', (e) => e.preventDefault());
    this.flow.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this.runMode === 'running' || this.runMode === 'stepping') return;

      const lv = this.levels[this.levelIndex];
      if (this.nodes.length >= lv.limit) {
        this.setStatus('Algorithm too long. Try solving it with fewer steps.', 'bad');
        return;
      }

      const shape = e.dataTransfer?.getData('shape');
      if (shape === 'process') this.nodes.push({ id: crypto.randomUUID(), type: 'process', action: lv.actions[0] });
      if (shape === 'decision') this.nodes.push({ id: crypto.randomUUID(), type: 'decision', condition: lv.decisions[0], onTrue: lv.actions[0], onFalse: 'none' });
      this.refreshFlow();
      this.updateHUD();
    });

    (document.getElementById('runBtn') as HTMLButtonElement).onclick = () => this.runAll();
    (document.getElementById('stepBtn') as HTMLButtonElement).onclick = () => this.stepOnce();
    (document.getElementById('resetBtn') as HTMLButtonElement).onclick = () => this.resetLevel();
    (document.getElementById('clearBtn') as HTMLButtonElement).onclick = () => {
      if (this.runMode === 'running' || this.runMode === 'stepping') return;
      this.nodes = [];
      this.pointer = 0;
      this.highlightErrorNode = '';
      this.highlightBranch = '';
      this.refreshFlow();
      this.updateHUD();
      this.setStatus('Flowchart cleared. Build a fresh algorithm path.');
    };
  }

  private loadLevel(index: number, keepFlow = false) {
    this.runnerToken++;
    this.runMode = 'idle';
    this.pointer = 0;
    this.highlightErrorNode = '';
    this.highlightBranch = '';

    this.levelIndex = index;
    this.disposeWorld();

    const level = this.levels[index];
    this.levelTemplate = level.grid.map((r) => r.slice());
    if (!keepFlow) this.nodes = [];
    this.levelEl.textContent = level.name;

    this.wood = 0;
    this.hasBoat = false;
    this.enteredCabin = false;
    this.traveled = [];

    this.buildWorld(level.grid);
    this.player = this.createExplorer();
    this.snapPlayerToState();

    this.camera.lockedTarget = this.player;
    this.refreshFlow();
    this.updateHUD();
    this.drawMiniMap();
    this.setStatus(level.instruction);
  }

  private disposeWorld() {
    this.scene.meshes.slice().forEach((m: any) => {
      if (m.name !== 'follow') m.dispose();
    });
  }

  private buildWorld(grid: string[]) {
    const matGrass = this.material('#7ccf74', '#5ba75a');
    const matDirt = this.material('#c29663', '#9b6f41');
    const matRock = this.material('#8e97a8', '#6a7282');
    const matWater = this.material('#5ec4ff', '#2d96e6', 0.92);
    const matHole = this.material('#2d2731', '#1e1821');

    // full terrain backdrop
    const rows = grid.length;
    const cols = grid[0].length;
    const plane = BABYLON.MeshBuilder.CreateGround('terrain', { width: cols * 2 + 8, height: rows * 2 + 8 }, this.scene);
    plane.position.set((cols - 1), -0.01, (rows - 1));
    plane.material = matGrass;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r][c] as Tile;
        const x = c * 2;
        const z = r * 2;

        const tile = BABYLON.MeshBuilder.CreateGround(`tile-${r}-${c}`, { width: 1.95, height: 1.95 }, this.scene);
        tile.position.set(x, 0, z);
        tile.material = t === '.' || t === 'S' || t === 'C' ? matDirt : matGrass;

        // variation props for adventure feel
        if (t === '.' && Math.random() > 0.78) this.makeBush(x + (Math.random() - 0.5) * 0.8, z + (Math.random() - 0.5) * 0.8);
        if (Math.random() > 0.93) this.makePebble(x + (Math.random() - 0.5), z + (Math.random() - 0.5));

        if (t === 'R') this.makeRock(x, z, matRock);
        if (t === 'H') this.makeHole(x, z, matHole);
        if (t === 'T') this.makeTree(x, z);
        if (t === 'W') this.makeWater(x, z, matWater);
        if (t === 'A') this.makeAnimal(x, z);

        if (t === 'S') {
          this.start = { r, c, dir: 1 };
          this.pos = { ...this.start };
        }
        if (t === 'C') {
          this.cabin = { r, c };
          this.makeCabin(x, z);
        }
      }
    }
  }

  private makeBush(x: number, z: number) {
    const bush = BABYLON.MeshBuilder.CreateSphere('bush', { diameter: 0.45 }, this.scene);
    bush.position.set(x, 0.2, z);
    bush.material = this.material('#62b56b', '#4a8c53');
  }

  private makePebble(x: number, z: number) {
    const p = BABYLON.MeshBuilder.CreateSphere('pebble', { diameter: 0.22 }, this.scene);
    p.position.set(x, 0.1, z);
    p.material = this.material('#b8bcc9', '#8e93a1');
  }

  private makeRock(x: number, z: number, mat: any) {
    const rock = BABYLON.MeshBuilder.CreateSphere('rock', { diameter: 1.35 }, this.scene);
    rock.position.set(x, 0.7, z);
    rock.scaling = new BABYLON.Vector3(1.12, 0.9, 0.92);
    rock.material = mat;
  }

  private makeHole(x: number, z: number, mat: any) {
    const rim = BABYLON.MeshBuilder.CreateTorus('hole-rim', { diameter: 1.45, thickness: 0.16 }, this.scene);
    rim.position.set(x, 0.06, z);
    rim.material = this.material('#5d4f3e', '#3c3125');
    const pit = BABYLON.MeshBuilder.CreateCylinder('hole', { diameter: 1.25, height: 0.34 }, this.scene);
    pit.position.set(x, 0.02, z);
    pit.material = mat;
  }

  private makeTree(x: number, z: number) {
    const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', { height: 1.15, diameter: 0.33 }, this.scene);
    trunk.position.set(x, 0.58, z);
    trunk.material = this.material('#8b5a2b', '#6e431f');
    const leaves = BABYLON.MeshBuilder.CreateSphere('leaves', { diameter: 1.15 }, this.scene);
    leaves.position.set(x, 1.45, z);
    leaves.material = this.material('#68be59', '#4a9442');
  }

  private makeWater(x: number, z: number, mat: any) {
    const w = BABYLON.MeshBuilder.CreateGround('water', { width: 1.9, height: 1.9 }, this.scene);
    w.position.set(x, 0.04, z);
    w.material = mat;
  }

  private makeAnimal(x: number, z: number) {
    const body = BABYLON.MeshBuilder.CreateSphere('animal', { diameter: 1.0 }, this.scene);
    body.position.set(x, 0.52, z);
    body.material = this.material('#d89b62', '#b8783f');
    const ear = BABYLON.MeshBuilder.CreateSphere('animal-ear', { diameter: 0.28 }, this.scene);
    ear.position.set(x + 0.3, 0.9, z + 0.18);
    ear.material = body.material;
  }

  private makeCabin(x: number, z: number) {
    const base = BABYLON.MeshBuilder.CreateBox('cabin-base', { width: 1.9, depth: 1.8, height: 1.25 }, this.scene);
    base.position.set(x, 0.62, z);
    base.material = this.material('#d8ab7c', '#ae7f4d');
    const roof = BABYLON.MeshBuilder.CreateCylinder('cabin-roof', { diameterTop: 0, diameterBottom: 2.4, height: 1.25, tessellation: 4 }, this.scene);
    roof.position.set(x, 1.6, z);
    roof.rotation.y = Math.PI / 4;
    roof.material = this.material('#a44334', '#7f2f26');

    this.cabinDoor = BABYLON.MeshBuilder.CreateBox('cabin-door', { width: 0.45, height: 0.78, depth: 0.07 }, this.scene);
    this.cabinDoor.position.set(x - 0.35, 0.42, z + 0.92);
    this.cabinDoor.material = this.material('#6f4a2b', '#4d2f18');
  }

  private createExplorer() {
    const body = BABYLON.MeshBuilder.CreateCapsule('explorer-body', { height: 1.16, radius: 0.34 }, this.scene);
    body.position.y = 0.78;
    body.material = this.material('#6acaff', '#3e9ad6');
    const bag = BABYLON.MeshBuilder.CreateBox('explorer-bag', { width: 0.4, height: 0.44, depth: 0.2 }, this.scene);
    bag.position.set(0, 0.82, -0.26);
    bag.material = this.material('#f2c278', '#d29f49');
    const eye = BABYLON.MeshBuilder.CreateSphere('explorer-eye', { diameter: 0.12 }, this.scene);
    eye.position.set(0.12, 1.01, 0.28);
    eye.material = this.material('#fff', '#ddd');
    return BABYLON.Mesh.MergeMeshes([body, bag, eye], true, false, undefined, false, true);
  }

  private material(main: string, glow: string, alpha = 1) {
    const m = new BABYLON.StandardMaterial(`m-${Math.random()}`, this.scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(main);
    m.emissiveColor = BABYLON.Color3.FromHexString(glow).scale(0.08);
    m.alpha = alpha;
    return m;
  }

  private refreshFlow(activeId = '') {
    const lv = this.levels[this.levelIndex];
    this.flow.innerHTML = '';
    this.flow.append(this.fixedNode('START', activeId === 'start', false));
    this.flow.append(this.connector());

    this.nodes.forEach((n, idx) => {
      this.flow.append(this.dynamicNode(n, activeId === n.id, lv));
      if (idx < this.nodes.length - 1) this.flow.append(this.connector());
    });

    this.flow.append(this.connector());
    this.flow.append(this.fixedNode('END', activeId === 'end', false));
  }

  private fixedNode(title: string, active: boolean, error: boolean) {
    const d = document.createElement('div');
    d.className = `node ${active ? 'active' : ''} ${error ? 'error' : ''}`.trim();
    d.innerHTML = `<span class="shape oval">${title}</span>`;
    return d;
  }

  private connector() {
    const c = document.createElement('div');
    c.className = 'conn';
    return c;
  }

  private dynamicNode(node: FlowNode, active: boolean, lv: Level) {
    const d = document.createElement('div');
    const isErr = this.highlightErrorNode === node.id;
    d.className = `node ${active ? 'active' : ''} ${isErr ? 'error' : ''}`.trim();
    d.draggable = this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success';
    d.dataset.id = node.id;

    d.addEventListener('dragstart', (e) => e.dataTransfer?.setData('moveNode', node.id));
    d.addEventListener('dragover', (e) => e.preventDefault());
    d.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!(this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success')) return;
      const moveId = e.dataTransfer?.getData('moveNode');
      if (!moveId || moveId === node.id) return;
      const from = this.nodes.findIndex((n) => n.id === moveId);
      const to = this.nodes.findIndex((n) => n.id === node.id);
      if (from < 0 || to < 0) return;
      const [picked] = this.nodes.splice(from, 1);
      this.nodes.splice(to, 0, picked);
      this.refreshFlow();
    });

    const drag = document.createElement('span');
    drag.className = 'drag';
    drag.textContent = '↕';
    d.append(drag);

    if (node.type === 'process') {
      const shape = document.createElement('span');
      shape.className = 'shape rect';
      shape.textContent = 'Process';
      d.append(shape);

      const action = document.createElement('select');
      lv.actions.forEach((a) => action.add(new Option(this.actionLabel(a), a)));
      action.value = node.action;
      action.disabled = !(this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success');
      action.onchange = () => (node.action = action.value as ProcessAction);
      d.append(action);
    } else {
      const shape = document.createElement('span');
      shape.className = 'shape diamond';
      shape.innerHTML = '<span>Decision</span>';
      d.append(shape);

      const cond = document.createElement('select');
      lv.decisions.forEach((dec) => cond.add(new Option(this.decisionLabel(dec), dec)));
      cond.value = node.condition;
      cond.disabled = !(this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success');
      cond.onchange = () => (node.condition = cond.value as DecisionAction);

      const t = document.createElement('select');
      ['none', ...lv.actions].forEach((a) => t.add(new Option(`True → ${a === 'none' ? 'Do nothing' : this.actionLabel(a as ProcessAction)}`, a)));
      t.value = node.onTrue;
      t.disabled = cond.disabled;
      t.onchange = () => (node.onTrue = t.value as ProcessAction | 'none');

      const f = document.createElement('select');
      ['none', ...lv.actions].forEach((a) => f.add(new Option(`False → ${a === 'none' ? 'Do nothing' : this.actionLabel(a as ProcessAction)}`, a)));
      f.value = node.onFalse;
      f.disabled = cond.disabled;
      f.onchange = () => (node.onFalse = f.value as ProcessAction | 'none');

      const badge = document.createElement('span');
      badge.style.fontWeight = '700';
      badge.style.color = this.highlightBranch === 'true' && active ? '#16a34a' : this.highlightBranch === 'false' && active ? '#d97706' : '#5b6ea7';
      badge.textContent = this.highlightBranch && active ? `Branch: ${this.highlightBranch.toUpperCase()}` : 'Branch: -';

      d.append(cond, t, f, badge);
    }

    const del = document.createElement('button');
    del.textContent = '✕';
    del.disabled = !(this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success');
    del.onclick = () => {
      this.nodes = this.nodes.filter((n) => n.id !== node.id);
      this.pointer = Math.min(this.pointer, this.nodes.length);
      this.refreshFlow();
      this.updateHUD();
    };
    d.append(del);

    return d;
  }

  private actionLabel(a: ProcessAction) {
    return {
      walk: 'Walk Forward', left: 'Turn Left', right: 'Turn Right', pushRock: 'Push Rock', jump: 'Jump',
      chopTree: 'Chop Tree', collectWood: 'Collect Wood', buildBoat: 'Build Boat', paddleAcross: 'Paddle Across',
      offerSnack: 'Offer Snack', enterCabin: 'Enter Cabin'
    }[a];
  }

  private decisionLabel(d: DecisionAction) {
    return {
      rockAhead: 'Rock ahead?', holeAhead: 'Hole ahead?', treeAhead: 'Tree ahead?', streamAhead: 'Stream ahead?',
      animalAhead: 'Animal ahead?', enoughWood: 'Enough wood?', exitAhead: 'Exit ahead?'
    }[d];
  }

  private front(state = this.pos) {
    const delta = [[-1, 0], [0, 1], [1, 0], [0, -1]][state.dir];
    return { r: state.r + delta[0], c: state.c + delta[1] };
  }

  private cell(r: number, c: number): Tile {
    const g = this.levelTemplate;
    if (r < 0 || c < 0 || r >= g.length || c >= g[0].length) return 'R';
    return g[r][c] as Tile;
  }

  private setCell(r: number, c: number, tile: Tile) {
    const rows = this.levelTemplate.map((line) => line.split(''));
    rows[r][c] = tile;
    this.levelTemplate = rows.map((r) => r.join(''));
  }

  private async runAll() {
    if (this.runMode === 'running' || this.runMode === 'stepping') return;
    if (this.nodes.length === 0) {
      this.setStatus('Add a few flowchart blocks first, then press Run.');
      return;
    }
    if (this.nodes.length > this.levels[this.levelIndex].limit) {
      this.setStatus('Algorithm too long. Try solving it with fewer steps.', 'bad');
      return;
    }

    this.runMode = 'running';
    const token = ++this.runnerToken;
    while (this.runMode === 'running' && this.pointer < this.nodes.length) {
      const ok = await this.executeAtPointer(token);
      if (!ok) break;
      await this.wait(260, token);
    }

    if (this.runMode === 'running') this.runMode = 'idle';
  }

  private async stepOnce() {
    if (this.runMode === 'running' || this.runMode === 'stepping') return;
    if (this.pointer >= this.nodes.length) {
      this.setStatus('No more blocks. Add more or Reset to try again.');
      return;
    }
    this.runMode = 'stepping';
    const token = ++this.runnerToken;
    const ok = await this.executeAtPointer(token);
    this.runMode = ok ? 'idle' : this.runMode;
  }

  private async executeAtPointer(token: number) {
    const node = this.nodes[this.pointer];
    if (!node) return false;

    this.highlightErrorNode = '';
    this.highlightBranch = '';
    this.stepEl.textContent = `Step ${this.pointer + 1}`;
    this.refreshFlow(node.id);

    let result: ExecResult = { ok: true };

    if (node.type === 'process') {
      result = await this.performAction(node.action, node.id, token);
    } else {
      const yes = this.evaluateDecision(node.condition);
      this.highlightBranch = yes ? 'true' : 'false';
      this.refreshFlow(node.id);
      this.setStatus(`${this.decisionLabel(node.condition)} ${yes ? 'Yes' : 'No'}.`);
      await this.wait(180, token);
      const action = yes ? node.onTrue : node.onFalse;
      if (action !== 'none') result = await this.performAction(action as ProcessAction, node.id, token);
    }

    if (!result.ok) {
      this.highlightErrorNode = node.id;
      this.refreshFlow(node.id);
      this.runMode = 'failed';
      this.setStatus(result.message || 'That plan did not work this time. Try adjusting your blocks.', 'bad');
      await this.failureNudge(token);
      return false;
    }

    this.pointer += 1;
    this.highlightBranch = '';
    this.refreshFlow();
    this.validateSync();
    return true;
  }

  private evaluateDecision(d: DecisionAction) {
    const f = this.front();
    const ahead = this.cell(f.r, f.c);
    if (d === 'rockAhead') return ahead === 'R';
    if (d === 'holeAhead') return ahead === 'H';
    if (d === 'treeAhead') return ahead === 'T';
    if (d === 'streamAhead') return ahead === 'W';
    if (d === 'animalAhead') return ahead === 'A';
    if (d === 'enoughWood') return this.wood > 0;
    if (d === 'exitAhead') return ahead === 'C';
    return false;
  }

  private async performAction(action: ProcessAction, nodeId: string, token: number): Promise<ExecResult> {
    if (token !== this.runnerToken) return { ok: false, message: 'Run interrupted.' };

    if (action === 'left' || action === 'right') {
      this.pos.dir = ((this.pos.dir + (action === 'right' ? 1 : 3)) % 4) as Dir;
      await this.animate(this.player, 'rotation.y', this.player.rotation.y, this.pos.dir * (Math.PI / 2), 12, token);
      this.drawMiniMap();
      return { ok: true };
    }

    if (action === 'enterCabin') {
      if (this.pos.r === this.cabin.r && this.pos.c === this.cabin.c) {
        this.enteredCabin = true;
        await this.animate(this.cabinDoor, 'rotation.y', this.cabinDoor.rotation.y, -1.25, 16, token);
        this.onSuccess();
        return { ok: true };
      }
      if (this.evaluateDecision('exitAhead')) return { ok: false, message: 'The cabin is still ahead — keep going.' };
      return { ok: false, message: 'You tried to enter the cabin too early.' };
    }

    const f = this.front();
    const ahead = this.cell(f.r, f.c);

    if (action === 'walk') {
      if (ahead === 'R') return { ok: false, message: 'A big rock blocks the trail. Try Push Rock first.' };
      if (ahead === 'H') return { ok: false, message: 'That step would fall into a hole. Try Jump.' };
      if (ahead === 'T') return { ok: false, message: 'A tree is in the way. Try Chop Tree first.' };
      if (ahead === 'W') return { ok: false, message: 'That is a stream. Build a boat, then paddle across.' };
      if (ahead === 'A') return { ok: false, message: 'A forest friend blocks the path. Offer Snack to pass.' };

      await this.moveTo(f.r, f.c, token, false);
      if (this.pos.r === this.cabin.r && this.pos.c === this.cabin.c && !this.enteredCabin) {
        this.setStatus('Cabin reached, but the algorithm is incomplete. Add Enter Cabin.', 'bad');
      }
      return { ok: true };
    }

    if (action === 'pushRock') {
      if (ahead !== 'R') return { ok: false, message: 'Push Rock works only when a rock is directly ahead.' };
      this.setCell(f.r, f.c, '.');
      await this.moveTo(f.r, f.c, token, false);
      this.setStatus('Nice push! The path is clear now.');
      return { ok: true };
    }

    if (action === 'jump') {
      if (ahead !== 'H') return { ok: false, message: 'Jump is best for crossing holes.' };
      this.setCell(f.r, f.c, '.');
      await this.moveTo(f.r, f.c, token, true);
      return { ok: true };
    }

    if (action === 'chopTree') {
      if (ahead !== 'T') return { ok: false, message: 'No tree ahead to chop right now.' };
      this.setCell(f.r, f.c, '.');
      this.setStatus('Chop! The trail is open.');
      return { ok: true };
    }

    if (action === 'collectWood') {
      if (ahead !== '.' && ahead !== 'W' && ahead !== 'C') return { ok: false, message: 'There is no loose wood to collect here.' };
      this.wood += 1;
      this.updateHUD();
      this.setStatus('Wood collected. Great planning!');
      return { ok: true };
    }

    if (action === 'buildBoat') {
      if (this.wood <= 0) return { ok: false, message: 'You need wood before building a boat.' };
      this.wood -= 1;
      this.hasBoat = true;
      this.updateHUD();
      this.setStatus('Boat ready! Now paddle across the stream.');
      return { ok: true };
    }

    if (action === 'paddleAcross') {
      if (ahead !== 'W') return { ok: false, message: 'Paddle Across only works when a stream is ahead.' };
      if (!this.hasBoat) return { ok: false, message: 'Build a boat first, then paddle.' };
      this.hasBoat = false;
      await this.moveTo(f.r, f.c, token, true);
      this.setStatus('Smooth crossing!');
      return { ok: true };
    }

    if (action === 'offerSnack') {
      if (ahead !== 'A') return { ok: false, message: 'No animal ahead right now for a snack break.' };
      this.setCell(f.r, f.c, '.');
      this.setStatus('The animal happily moved aside 🐾');
      return { ok: true };
    }

    return { ok: true };
  }

  private async moveTo(r: number, c: number, token: number, arc: boolean) {
    const start = this.player.position.clone();
    const end = new BABYLON.Vector3(c * 2, 0.78, r * 2);

    this.pos.r = r;
    this.pos.c = c;
    this.traveled.push({ r, c });

    if (arc) {
      await this.animate(this.player, 'position.y', 0.78, 1.36, 8, token);
      await this.animate(this.player, 'position.y', 1.36, 0.78, 8, token);
    }
    await this.animate(this.player, 'position', start, end, 16, token);

    this.validateSync();
    this.drawMiniMap();
    this.updateHUD();
  }

  private async failureNudge(token: number) {
    const original = this.player.rotation.z;
    await this.animate(this.player, 'rotation.z', original, 0.2, 5, token);
    await this.animate(this.player, 'rotation.z', 0.2, -0.2, 6, token);
    await this.animate(this.player, 'rotation.z', -0.2, 0, 6, token);
    await this.wait(250, token);
  }

  private animate(target: any, prop: string, from: any, to: any, frames: number, token: number) {
    if (token !== this.runnerToken) return Promise.resolve();
    return BABYLON.Animation.CreateAndStartAnimation(`anim-${Math.random()}`, target, prop, 30, frames, from, to, 0);
  }

  private wait(ms: number, token: number) {
    return new Promise<void>((resolve) => {
      const started = this.runnerToken;
      setTimeout(() => {
        if (token === started && token === this.runnerToken) resolve();
        else resolve();
      }, ms);
    });
  }

  private validateSync() {
    const rows = this.levelTemplate.length;
    const cols = this.levelTemplate[0].length;
    if (this.pos.r < 0 || this.pos.c < 0 || this.pos.r >= rows || this.pos.c >= cols) {
      this.setStatus('Quick safety reset: explorer returned to the trail start.', 'bad');
      this.resetLevel();
      return;
    }

    const target = new BABYLON.Vector3(this.pos.c * 2, 0.78, this.pos.r * 2);
    const current = this.player.position;
    const dx = Math.abs(current.x - target.x);
    const dz = Math.abs(current.z - target.z);
    if (dx > 0.35 || dz > 0.35) {
      this.player.position = target;
    }
  }

  private snapPlayerToState() {
    this.player.position = new BABYLON.Vector3(this.pos.c * 2, 0.78, this.pos.r * 2);
    this.player.rotation = new BABYLON.Vector3(0, this.pos.dir * (Math.PI / 2), 0);
  }

  private onSuccess() {
    this.runMode = 'success';
    this.stepEl.textContent = `Step ${this.pointer + 1}`;
    this.flow.querySelectorAll('.node').forEach((n) => n.classList.add('success'));
    const stars = this.computeStars();
    this.setStatus(`Success! You reached home and entered the cabin. ⭐ ${stars}/3`, 'good');
    this.updateHUD();

    if (this.levelIndex < this.levels.length - 1) {
      setTimeout(() => this.loadLevel(this.levelIndex + 1), 1400);
    }
  }

  private computeStars() {
    let stars = 0;
    if (this.enteredCabin) stars++;
    if (this.nodes.length <= this.levels[this.levelIndex].limit) stars++;
    if (this.nodes.length <= this.levels[this.levelIndex].perfect) stars++;
    return stars;
  }

  private resetLevel() {
    this.loadLevel(this.levelIndex, false);
  }

  private setStatus(text: string, type: '' | 'good' | 'bad' = '') {
    this.statusEl.className = `status ${type}`.trim();
    this.statusEl.textContent = text;
  }

  private updateHUD() {
    const lv = this.levels[this.levelIndex];
    this.invEl.textContent = `Wood: ${this.wood}`;
    this.limitEl.textContent = `Blocks Remaining: ${Math.max(0, lv.limit - this.nodes.length)}`;
    this.starEl.textContent = `⭐ ${this.enteredCabin ? this.computeStars() : 0}/3`;
  }

  private drawMiniMap() {
    const ctx = this.miniCanvas.getContext('2d')!;
    const g = this.levelTemplate;
    const rows = g.length;
    const cols = g[0].length;
    const cell = Math.min(this.miniCanvas.width / cols, this.miniCanvas.height / rows);

    ctx.clearRect(0, 0, this.miniCanvas.width, this.miniCanvas.height);
    const color: Record<string, string> = {
      '.': '#c79862', S: '#5ec8ff', C: '#ffb772', R: '#8790a2', H: '#302b35', T: '#4aaa4d', W: '#64c8ff', A: '#da9a63'
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = g[r][c];
        ctx.fillStyle = color[tile] || '#ccc';
        ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
      }
    }

    this.traveled.forEach((p) => {
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillRect(p.c * cell + cell * 0.3, p.r * cell + cell * 0.3, cell * 0.4, cell * 0.4);
    });

    ctx.fillStyle = '#1f4b9b';
    ctx.beginPath();
    ctx.arc(this.pos.c * cell + cell / 2, this.pos.r * cell + cell / 2, cell * 0.24, 0, Math.PI * 2);
    ctx.fill();

    const f = this.front();
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(this.pos.c * cell + cell / 2, this.pos.r * cell + cell / 2);
    ctx.lineTo(f.c * cell + cell / 2, f.r * cell + cell / 2);
    ctx.stroke();
  }
}

new CrossTheValley();
