declare const BABYLON: any;

type Dir = 0 | 1 | 2 | 3; // N,E,S,W
interface LevelData {
  name: string;
  grid: string[];
  optimalBlocks: number;
  crystals: Array<{ r: number; c: number }>;
}
interface RobotState { r: number; c: number; dir: Dir; }
interface FlowNode {
  id: string;
  type: 'start' | 'process' | 'decision' | 'end';
  action?: 'forward' | 'left' | 'right' | 'jump';
  condition?: 'wallAhead' | 'holeAhead' | 'exitAhead';
  trueAction?: 'forward' | 'left' | 'right' | 'jump' | 'none';
  falseAction?: 'forward' | 'left' | 'right' | 'jump' | 'none';
}

class FlowMazeGame {
  private canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  private miniMapCanvas = document.getElementById('miniMapCanvas') as HTMLCanvasElement;
  private flowCanvas = document.getElementById('flowCanvas') as HTMLDivElement;
  private levelLabel = document.getElementById('levelLabel') as HTMLSpanElement;
  private stepLabel = document.getElementById('stepLabel') as HTMLSpanElement;
  private starLabel = document.getElementById('starLabel') as HTMLSpanElement;
  private statusBox = document.getElementById('statusBox') as HTMLDivElement;

  private engine: any;
  private scene: any;
  private camera: any;
  private robotMesh: any;
  private portalMesh: any;
  private wallMeshes: any[] = [];
  private crystalMeshes = new Map<string, any>();

  private levels: LevelData[] = [
    {
      name: 'Level 1 · Sequence Basics',
      grid: [
        '#######',
        '#S...E#',
        '#.###.#',
        '#.....#',
        '#######'
      ],
      optimalBlocks: 4,
      crystals: [{ r: 3, c: 3 }]
    },
    {
      name: 'Level 2 · Turning Routes',
      grid: [
        '########',
        '#S..#..#',
        '###.#.##',
        '#...#E.#',
        '#.####.#',
        '#......#',
        '########'
      ],
      optimalBlocks: 7,
      crystals: [{ r: 5, c: 2 }, { r: 1, c: 6 }]
    },
    {
      name: 'Level 3 · Decisions + Jumping',
      grid: [
        '#########',
        '#S..O...#',
        '###.#.#E#',
        '#...O...#',
        '#.#####.#',
        '#.......#',
        '#########'
      ],
      optimalBlocks: 9,
      crystals: [{ r: 5, c: 3 }, { r: 1, c: 6 }, { r: 3, c: 7 }]
    }
  ];

  private levelIndex = 0;
  private robot: RobotState = { r: 0, c: 0, dir: 1 };
  private start: RobotState = { r: 0, c: 0, dir: 1 };
  private exit = { r: 0, c: 0 };
  private flowNodes: FlowNode[] = [];
  private running = false;
  private step = 0;
  private collected = new Set<string>();
  private travelPath: Array<{r:number;c:number}> = [];

  constructor() {
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true });
    this.scene = this.createScene();
    this.wireUi();
    this.loadLevel(0);
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', () => this.engine.resize());
  }

  private createScene() {
    const scene = new BABYLON.Scene(this.engine);
    scene.clearColor = new BABYLON.Color4(0.03, 0.06, 0.14, 1);

    this.camera = new BABYLON.ArcRotateCamera('cam', Math.PI / 4, 1.15, 24, new BABYLON.Vector3(0, 0, 0), scene);
    this.camera.attachControl(this.canvas, true);
    this.camera.lowerRadiusLimit = 13;
    this.camera.upperRadiusLimit = 35;

    const hemi = new BABYLON.HemisphericLight('hem', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.8;
    const point = new BABYLON.PointLight('p', new BABYLON.Vector3(0, 8, -2), scene);
    point.intensity = 0.75;

    const glow = new BABYLON.GlowLayer('glow', scene);
    glow.intensity = 0.8;

    return scene;
  }

  private loadLevel(index: number) {
    this.levelIndex = index;
    this.clearSceneMeshes();
    const lv = this.levels[index];
    this.levelLabel.textContent = lv.name;
    this.step = 0;
    this.collected.clear();
    this.travelPath = [];

    const floorMat = new BABYLON.StandardMaterial('floorMat', this.scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.12, 0.21, 0.44);
    floorMat.emissiveColor = new BABYLON.Color3(0.03, 0.07, 0.14);

    const wallMat = new BABYLON.StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.22, 0.37, 0.75);

    const holeMat = new BABYLON.StandardMaterial('holeMat', this.scene);
    holeMat.diffuseColor = new BABYLON.Color3(0.02, 0.03, 0.09);

    lv.grid.forEach((row, r) => row.split('').forEach((cell, c) => {
      const x = c * 2;
      const z = r * 2;
      if (cell !== 'O') {
        const tile = BABYLON.MeshBuilder.CreateGround(`tile-${r}-${c}`, { width: 2, height: 2 }, this.scene);
        tile.position = new BABYLON.Vector3(x, 0, z);
        tile.material = floorMat;
      } else {
        const ring = BABYLON.MeshBuilder.CreateTorus(`hole-${r}-${c}`, { diameter: 1.8, thickness: 0.2 }, this.scene);
        ring.position = new BABYLON.Vector3(x, 0.05, z);
        ring.material = holeMat;
      }

      if (cell === '#') {
        const wall = BABYLON.MeshBuilder.CreateBox(`wall-${r}-${c}`, { size: 2, height: 2.4 }, this.scene);
        wall.position = new BABYLON.Vector3(x, 1.2, z);
        wall.material = wallMat;
        this.wallMeshes.push(wall);
      }
      if (cell === 'S') {
        this.start = { r, c, dir: 1 };
        this.robot = { ...this.start };
      }
      if (cell === 'E') this.exit = { r, c };
    }));

    this.portalMesh = BABYLON.MeshBuilder.CreateTorus('portal', { diameter: 1.4, thickness: 0.25 }, this.scene);
    this.portalMesh.position = new BABYLON.Vector3(this.exit.c * 2, 1.1, this.exit.r * 2);
    this.portalMesh.rotation.x = Math.PI / 2;
    const portalMat = new BABYLON.StandardMaterial('portalMat', this.scene);
    portalMat.emissiveColor = new BABYLON.Color3(0.1, 0.9, 1);
    portalMat.diffuseColor = new BABYLON.Color3(0.03, 0.3, 0.5);
    this.portalMesh.material = portalMat;

    this.robotMesh = this.buildRobot();
    this.placeRobot();
    this.spawnCrystals();

    this.camera.target = new BABYLON.Vector3((lv.grid[0].length - 1), 0, (lv.grid.length - 1));
    this.refreshFlowCanvas();
    this.updateStatus('Set up your flowchart and run the robot through the maze.');
    this.drawMiniMap();
  }

  private buildRobot() {
    const body = BABYLON.MeshBuilder.CreateBox('rb-body', { width: 1, depth: 1, height: 1.1 }, this.scene);
    body.position.y = 0.9;
    const head = BABYLON.MeshBuilder.CreateSphere('rb-head', { diameter: 0.8 }, this.scene);
    head.position.y = 1.7;
    const eye = BABYLON.MeshBuilder.CreateSphere('rb-eye', { diameter: 0.15 }, this.scene);
    eye.position = new BABYLON.Vector3(0.2, 1.78, 0.35);
    const eye2 = eye.clone('rb-eye2'); eye2.position.x = -0.2;
    const antenna = BABYLON.MeshBuilder.CreateCylinder('rb-ant', { height: 0.45, diameter: 0.08 }, this.scene);
    antenna.position.y = 2.2;

    const mat = new BABYLON.StandardMaterial('robotMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.71, 0.9, 1.0);
    mat.emissiveColor = new BABYLON.Color3(0.15, 0.2, 0.3);
    [body, head, antenna, eye, eye2].forEach((m) => m.material = mat);

    const robot = BABYLON.Mesh.MergeMeshes([body, head, eye, eye2, antenna], true, false, undefined, false, true);
    return robot;
  }

  private spawnCrystals() {
    this.crystalMeshes.clear();
    this.levels[this.levelIndex].crystals.forEach((cr, i) => {
      const crystal = BABYLON.MeshBuilder.CreatePolyhedron(`crystal-${i}`, { type: 1, size: 0.4 }, this.scene);
      crystal.position = new BABYLON.Vector3(cr.c * 2, 0.55, cr.r * 2);
      const mat = new BABYLON.StandardMaterial(`cMat-${i}`, this.scene);
      mat.emissiveColor = new BABYLON.Color3(0.8, 0.95, 1);
      mat.diffuseColor = new BABYLON.Color3(0.25, 0.8, 1);
      crystal.material = mat;
      this.crystalMeshes.set(`${cr.r},${cr.c}`, crystal);
    });
  }

  private clearSceneMeshes() {
    this.scene.meshes.slice().forEach((m: any) => {
      if (m.name !== 'cam') m.dispose();
    });
    this.wallMeshes = [];
  }

  private wireUi() {
    const bank = document.getElementById('shapeBank') as HTMLDivElement;
    bank.querySelectorAll<HTMLElement>('.shape').forEach((shape) => {
      shape.addEventListener('dragstart', (e) => e.dataTransfer?.setData('shape', shape.dataset.shape || 'process'));
    });

    this.flowCanvas.addEventListener('dragover', (e) => e.preventDefault());
    this.flowCanvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const shape = e.dataTransfer?.getData('shape');
      if (!shape || shape === 'start') return;
      this.flowNodes.push(this.defaultNode(shape as any));
      this.refreshFlowCanvas();
    });

    (document.getElementById('runBtn') as HTMLButtonElement).onclick = () => this.runAll();
    (document.getElementById('stepBtn') as HTMLButtonElement).onclick = () => this.runSingleStep();
    (document.getElementById('resetBtn') as HTMLButtonElement).onclick = () => this.resetLevel();
    (document.getElementById('clearBtn') as HTMLButtonElement).onclick = () => {
      this.flowNodes = []; this.refreshFlowCanvas(); this.updateStatus('Flowchart cleared. Build a new algorithm.');
    };
  }

  private defaultNode(shape: 'process' | 'decision' | 'end'): FlowNode {
    if (shape === 'process') return { id: crypto.randomUUID(), type: 'process', action: 'forward' };
    if (shape === 'decision') return { id: crypto.randomUUID(), type: 'decision', condition: 'holeAhead', trueAction: 'jump', falseAction: 'forward' };
    return { id: crypto.randomUUID(), type: 'end' };
  }

  private refreshFlowCanvas(activeId = '') {
    this.flowCanvas.innerHTML = '';
    const startNode = this.makeNodeElement({ id: 'start', type: 'start' }, activeId);
    this.flowCanvas.appendChild(startNode);
    this.flowCanvas.appendChild(this.connector(false));

    this.flowNodes.forEach((node, idx) => {
      this.flowCanvas.appendChild(this.makeNodeElement(node, activeId));
      if (idx < this.flowNodes.length - 1) this.flowCanvas.appendChild(this.connector(false));
    });

    this.flowCanvas.appendChild(this.connector(false));
    this.flowCanvas.appendChild(this.makeNodeElement({ id: 'end', type: 'end' }, activeId));
  }

  private connector(active: boolean) {
    const el = document.createElement('div');
    el.className = `connector ${active ? 'active' : ''}`;
    return el;
  }

  private makeNodeElement(node: FlowNode, activeId: string) {
    const wrap = document.createElement('div');
    wrap.className = `node ${activeId === node.id ? 'active' : ''}`;
    wrap.draggable = node.type === 'process' || node.type === 'decision';
    wrap.dataset.id = node.id;
    wrap.addEventListener('dragstart', (e) => e.dataTransfer?.setData('moveNode', node.id));
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const moveId = e.dataTransfer?.getData('moveNode');
      if (!moveId || moveId === node.id) return;
      const from = this.flowNodes.findIndex(n => n.id === moveId);
      const to = this.flowNodes.findIndex(n => n.id === node.id);
      if (from < 0 || to < 0) return;
      const [picked] = this.flowNodes.splice(from, 1);
      this.flowNodes.splice(to, 0, picked);
      this.refreshFlowCanvas();
    });

    if (node.type === 'start' || node.type === 'end') {
      wrap.innerHTML = `<span class="shape oval">${node.type === 'start' ? 'START' : 'END'}</span><span class="label">${node.type === 'start' ? 'Entry point' : 'Goal check'}</span>`;
      return wrap;
    }

    const drag = document.createElement('span');
    drag.className = 'drag'; drag.textContent = '↕';
    wrap.appendChild(drag);

    const shape = document.createElement('span');
    shape.className = `shape ${node.type === 'process' ? 'rect' : 'diamond'}`;
    shape.innerHTML = node.type === 'process' ? 'Process' : '<span>Decision</span>';
    wrap.appendChild(shape);

    if (node.type === 'process') {
      const s = document.createElement('select');
      ['forward','left','right','jump'].forEach(v => s.add(new Option(this.actionLabel(v as any), v)));
      s.value = node.action || 'forward';
      s.onchange = () => { node.action = s.value as any; };
      wrap.appendChild(s);
    } else {
      const cond = document.createElement('select');
      [['wallAhead','Wall ahead?'], ['holeAhead','Hole ahead?'], ['exitAhead','Exit ahead?']].forEach(([v,t]) => cond.add(new Option(t,v)));
      cond.value = node.condition || 'holeAhead';
      cond.onchange = () => { node.condition = cond.value as any; };

      const tSel = document.createElement('select');
      ['jump','forward','left','right','none'].forEach(v => tSel.add(new Option(`True:${this.actionLabel(v as any)}`, v)));
      tSel.value = node.trueAction || 'jump';
      tSel.onchange = () => node.trueAction = tSel.value as any;

      const fSel = document.createElement('select');
      ['forward','left','right','jump','none'].forEach(v => fSel.add(new Option(`False:${this.actionLabel(v as any)}`, v)));
      fSel.value = node.falseAction || 'forward';
      fSel.onchange = () => node.falseAction = fSel.value as any;

      wrap.append(cond, tSel, fSel);
    }

    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => {
      this.flowNodes = this.flowNodes.filter((n) => n.id !== node.id);
      this.refreshFlowCanvas();
    };
    wrap.appendChild(del);
    return wrap;
  }

  private actionLabel(action: 'forward'|'left'|'right'|'jump'|'none') {
    return ({ forward: 'Move Forward', left: 'Turn Left', right: 'Turn Right', jump: 'Jump Forward', none: 'Do Nothing' } as any)[action];
  }

  private frontCell(state = this.robot) {
    const delta = [[-1,0],[0,1],[1,0],[0,-1]][state.dir];
    return { r: state.r + delta[0], c: state.c + delta[1] };
  }

  private getCell(r:number,c:number) {
    const grid = this.levels[this.levelIndex].grid;
    if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) return '#';
    return grid[r][c];
  }

  private evaluate(cond: FlowNode['condition']) {
    const f = this.frontCell();
    const cell = this.getCell(f.r, f.c);
    if (cond === 'wallAhead') return cell === '#';
    if (cond === 'holeAhead') return cell === 'O';
    if (cond === 'exitAhead') return cell === 'E';
    return false;
  }

  private async runAll() {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < this.flowNodes.length; i++) {
      const ok = await this.executeNode(this.flowNodes[i], i + 1);
      if (!ok) break;
      if (this.checkSuccess()) break;
      await this.delay(250);
    }
    this.running = false;
  }

  private async runSingleStep() {
    if (this.running) return;
    const node = this.flowNodes[this.step];
    if (!node) return this.updateStatus('No more blocks. Add blocks or press Reset.', 'bad');
    this.running = true;
    const ok = await this.executeNode(node, this.step + 1);
    if (ok) this.step += 1;
    this.running = false;
  }

  private async executeNode(node: FlowNode, step: number) {
    this.stepLabel.textContent = `Step ${step}`;
    this.refreshFlowCanvas(node.id);

    if (node.type === 'process') {
      const result = await this.performAction(node.action || 'forward', step);
      if (!result) return false;
    }

    if (node.type === 'decision') {
      const branch = this.evaluate(node.condition);
      const chosen = branch ? (node.trueAction || 'jump') : (node.falseAction || 'forward');
      this.updateStatus(`Decision (${node.condition}) was ${branch ? 'TRUE' : 'FALSE'} → ${this.actionLabel(chosen)}`);
      if (chosen !== 'none') {
        const result = await this.performAction(chosen as any, step);
        if (!result) return false;
      }
    }

    if (this.checkSuccess()) return true;
    return true;
  }

  private async performAction(action: 'forward'|'left'|'right'|'jump', step: number) {
    if (action === 'left' || action === 'right') {
      this.robot.dir = ((this.robot.dir + (action === 'right' ? 1 : 3)) % 4) as Dir;
      await BABYLON.Animation.CreateAndStartAnimation('turn', this.robotMesh, 'rotation.y', 30, 12, this.robotMesh.rotation.y, this.robot.dir * (Math.PI/2), 0);
      this.placeRobot();
      this.updateStatus(`${this.actionLabel(action)} executed.`);
      this.drawMiniMap();
      return true;
    }

    const f = this.frontCell();
    const cell = this.getCell(f.r, f.c);
    if (action === 'forward') {
      if (cell === '#') return this.fail(`Algorithm failed: Robot hit a wall at Step ${step}.`);
      if (cell === 'O') return this.fail(`Algorithm failed: Robot fell into a hole at Step ${step}.`, true);
      await this.walkTo(f.r, f.c);
      return true;
    }

    if (action === 'jump') {
      if (cell === '#') return this.fail(`Algorithm failed: Jump collided with a wall at Step ${step}.`);
      await this.jumpTo(f.r, f.c);
      return true;
    }

    return true;
  }

  private async walkTo(r:number,c:number) {
    const from = this.robotMesh.position.clone();
    const to = new BABYLON.Vector3(c * 2, 0.9, r * 2);
    this.robot = { ...this.robot, r, c };
    this.travelPath.push({ r, c });
    await BABYLON.Animation.CreateAndStartAnimation('walk', this.robotMesh, 'position', 30, 16, from, to, 0);
    this.onRobotMoved();
  }

  private async jumpTo(r:number,c:number) {
    const start = this.robotMesh.position.clone();
    const end = new BABYLON.Vector3(c * 2, 0.9, r * 2);
    this.robot = { ...this.robot, r, c };
    this.travelPath.push({ r, c });
    await BABYLON.Animation.CreateAndStartAnimation('jump', this.robotMesh, 'position', 30, 18, start, end, 0);
    this.onRobotMoved();
  }

  private onRobotMoved() {
    this.placeRobot();
    const key = `${this.robot.r},${this.robot.c}`;
    if (this.crystalMeshes.has(key) && !this.collected.has(key)) {
      this.collected.add(key);
      this.crystalMeshes.get(key).dispose();
      this.starLabel.textContent = `⭐ ${this.computeStars()}/3`;
    }
    this.drawMiniMap();
  }

  private computeStars() {
    let stars = 0;
    if (this.robot.r === this.exit.r && this.robot.c === this.exit.c) stars++;
    if (this.flowNodes.length <= this.levels[this.levelIndex].optimalBlocks) stars++;
    if (this.collected.size === this.levels[this.levelIndex].crystals.length) stars++;
    return stars;
  }

  private checkSuccess() {
    if (this.robot.r !== this.exit.r || this.robot.c !== this.exit.c) return false;
    this.portalMesh.scaling = new BABYLON.Vector3(1.6, 1.6, 1.6);
    this.flowCanvas.querySelectorAll('.node').forEach((n) => n.classList.add('success'));
    const stars = this.computeStars();
    this.starLabel.textContent = `⭐ ${stars}/3`;
    this.updateStatus(`Escape successful! You earned ${stars} star${stars > 1 ? 's' : ''}.`, 'good');
    if (this.levelIndex < this.levels.length - 1) {
      setTimeout(() => this.loadLevel(this.levelIndex + 1), 1400);
    }
    return true;
  }

  private fail(message: string, hole = false) {
    if (hole) {
      this.robotMesh.position.y = 0.1;
      this.robotMesh.scaling.y = 0.7;
    }
    this.updateStatus(message, 'bad');
    this.running = false;
    return false;
  }

  private resetLevel() {
    this.robot = { ...this.start };
    this.placeRobot();
    this.step = 0;
    this.collected.clear();
    this.starLabel.textContent = '⭐ 0/3';
    this.spawnCrystals();
    this.travelPath = [];
    this.refreshFlowCanvas();
    this.drawMiniMap();
    this.updateStatus('Level reset. Adjust the algorithm and try again.');
  }

  private placeRobot() {
    this.robotMesh.position = new BABYLON.Vector3(this.robot.c * 2, 0.9, this.robot.r * 2);
    this.robotMesh.rotation = new BABYLON.Vector3(0, this.robot.dir * (Math.PI / 2), 0);
  }

  private drawMiniMap() {
    const ctx = this.miniMapCanvas.getContext('2d')!;
    const lv = this.levels[this.levelIndex];
    const rows = lv.grid.length;
    const cols = lv.grid[0].length;
    ctx.clearRect(0, 0, this.miniMapCanvas.width, this.miniMapCanvas.height);
    const cell = Math.min(this.miniMapCanvas.width / cols, this.miniMapCanvas.height / rows);

    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cell, y = r * cell;
      const ch = lv.grid[r][c];
      ctx.fillStyle = ch === '#' ? '#4664a8' : ch === 'O' ? '#060d21' : '#16305a';
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      if (ch === 'E') { ctx.fillStyle = '#43ffd5'; ctx.fillRect(x + cell * .25, y + cell * .25, cell * .5, cell * .5); }
    }

    this.travelPath.forEach((p) => {
      ctx.fillStyle = 'rgba(255, 209, 102, .6)';
      ctx.fillRect(p.c * cell + cell * .33, p.r * cell + cell * .33, cell * .34, cell * .34);
    });

    ctx.fillStyle = '#79f3ff';
    ctx.beginPath();
    ctx.arc(this.robot.c * cell + cell / 2, this.robot.r * cell + cell / 2, cell * .27, 0, Math.PI * 2);
    ctx.fill();

    const fr = this.frontCell();
    ctx.strokeStyle = '#b8e7ff';
    ctx.beginPath();
    ctx.moveTo(this.robot.c * cell + cell / 2, this.robot.r * cell + cell / 2);
    ctx.lineTo(fr.c * cell + cell / 2, fr.r * cell + cell / 2);
    ctx.stroke();
  }

  private updateStatus(text: string, type: '' | 'good' | 'bad' = '') {
    this.statusBox.className = `status ${type}`.trim();
    this.statusBox.textContent = text;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

new FlowMazeGame();
