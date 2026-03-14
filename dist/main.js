"use strict";
class CrossTheValley {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.miniCanvas = document.getElementById('miniMap');
        this.flow = document.getElementById('flow');
        this.statusEl = document.getElementById('status');
        this.levelEl = document.getElementById('levelLabel');
        this.stepEl = document.getElementById('stepLabel');
        this.invEl = document.getElementById('invLabel');
        this.limitEl = document.getElementById('limitLabel');
        this.starEl = document.getElementById('starLabel');
        this.rockMeshes = new Map();
        this.nodes = [];
        this.runnerToken = 0;
        this.runMode = 'idle';
        this.pointer = 0;
        this.highlightErrorNode = '';
        this.highlightBranch = '';
        this.levelIndex = 0;
        this.levelTemplate = [];
        this.pos = { r: 0, c: 0, dir: 1 };
        this.start = { r: 0, c: 0, dir: 1 };
        this.cabin = { r: 0, c: 0 };
        this.wood = 0;
        this.hasBoat = false;
        this.enteredCabin = false;
        this.traveled = [];
        this.levels = [
            {
                name: 'Level 1 · Basic obstacle reactions',
                instruction: 'Use Rock/Hole decisions and actions to cross, then Enter Cabin.',
                limit: 6,
                perfect: 5,
                grid: ['........', '.S.R.H.C', '........'],
                actions: ['walk', 'left', 'right', 'kickRock', 'jump', 'enterCabin'],
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
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.scene = this.buildScene();
        this.wireUI();
        this.loadLevel(0, true);
        this.engine.runRenderLoop(() => this.scene.render());
        window.addEventListener('resize', () => this.engine.resize());
    }
    buildScene() {
        const scene = new BABYLON.Scene(this.engine);
        scene.clearColor = new BABYLON.Color4(0.62, 0.84, 1, 1);
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP;
        scene.fogDensity = 0.012;
        scene.fogColor = new BABYLON.Color3(0.75, 0.9, 1);
        const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
        hemi.intensity = 0.78;
        hemi.groundColor = new BABYLON.Color3(0.45, 0.54, 0.33);
        const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.35, -1, -0.18), scene);
        sun.position = new BABYLON.Vector3(18, 28, -12);
        sun.intensity = 1.0;
        this.camera = new BABYLON.FollowCamera('follow', new BABYLON.Vector3(0, 12, -10), scene);
        this.camera.radius = 16;
        this.camera.heightOffset = 10;
        this.camera.rotationOffset = 180;
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxCameraSpeed = 14;
        return scene;
    }
    wireUI() {
        document.querySelectorAll('#shapeBank .shape').forEach((shape) => {
            shape.addEventListener('dragstart', (e) => { var _a; return (_a = e.dataTransfer) === null || _a === void 0 ? void 0 : _a.setData('shape', shape.dataset.shape || 'process'); });
        });
        this.flow.addEventListener('dragover', (e) => e.preventDefault());
        this.flow.addEventListener('drop', (e) => {
            var _a;
            e.preventDefault();
            if (this.runMode === 'running' || this.runMode === 'stepping')
                return;
            const lv = this.levels[this.levelIndex];
            if (this.nodes.length >= lv.limit) {
                this.setStatus('Algorithm too long. Try solving it with fewer steps.', 'bad');
                return;
            }
            const shape = (_a = e.dataTransfer) === null || _a === void 0 ? void 0 : _a.getData('shape');
            if (shape === 'process')
                this.nodes.push({ id: crypto.randomUUID(), type: 'process', action: lv.actions[0] });
            if (shape === 'decision')
                this.nodes.push({ id: crypto.randomUUID(), type: 'decision', condition: lv.decisions[0], onTrue: lv.actions[0], onFalse: 'none' });
            this.refreshFlow();
            this.updateHUD();
        });
        document.getElementById('runBtn').onclick = () => this.runAll();
        document.getElementById('stepBtn').onclick = () => this.stepOnce();
        document.getElementById('resetBtn').onclick = () => this.resetLevel();
        document.getElementById('clearBtn').onclick = () => {
            if (this.runMode === 'running' || this.runMode === 'stepping')
                return;
            this.nodes = [];
            this.pointer = 0;
            this.highlightErrorNode = '';
            this.highlightBranch = '';
            this.refreshFlow();
            this.updateHUD();
            this.setStatus('Flowchart cleared. Build a fresh algorithm path.');
        };
    }
    loadLevel(index, keepFlow = false) {
        this.runnerToken++;
        this.runMode = 'idle';
        this.pointer = 0;
        this.highlightErrorNode = '';
        this.highlightBranch = '';
        this.levelIndex = index;
        this.disposeWorld();
        const level = this.levels[index];
        this.levelTemplate = level.grid.map((r) => r.slice());
        if (!keepFlow)
            this.nodes = [];
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
    disposeWorld() {
        this.scene.meshes.slice().forEach((m) => {
            if (m.name !== 'follow')
                m.dispose();
        });
        this.rockMeshes.clear();
    }
    buildWorld(grid) {
        const matGrass = this.material('#7ec96e', '#5ba458');
        const matPath = this.material('#c69b67', '#9d7547');
        const matPathEdge = this.material('#b58a5a', '#91683d');
        const matRock = this.material('#8e97a8', '#6a7282');
        const matWater = this.material('#69c8ff', '#3ca3ef', 0.94);
        const matHole = this.material('#3b2e2a', '#1e1816');
        const rows = grid.length;
        const cols = grid[0].length;
        const terrain = BABYLON.MeshBuilder.CreateGround('terrain', { width: cols * 2 + 16, height: rows * 2 + 16 }, this.scene);
        terrain.position.set((cols - 1), -0.03, (rows - 1));
        terrain.material = matGrass;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const t = grid[r][c];
                const x = c * 2;
                const z = r * 2;
                const pathTile = t === '.' || t === 'S' || t === 'C';
                const tile = BABYLON.MeshBuilder.CreateGround(`tile-${r}-${c}`, { width: pathTile ? 1.9 : 1.96, height: pathTile ? 1.9 : 1.96 }, this.scene);
                tile.position.set(x, 0, z);
                tile.material = pathTile ? matPath : matGrass;
                if (pathTile) {
                    const edge = BABYLON.MeshBuilder.CreateGround(`path-edge-${r}-${c}`, { width: 2.08, height: 2.08 }, this.scene);
                    edge.position.set(x, -0.005, z);
                    edge.material = matPathEdge;
                    edge.visibility = 0.55;
                }
                if (pathTile && Math.random() > 0.8)
                    this.makeFlower(x + (Math.random() - 0.5) * 0.9, z + (Math.random() - 0.5) * 0.9);
                if (!pathTile && Math.random() > 0.72)
                    this.makeBush(x + (Math.random() - 0.5) * 0.9, z + (Math.random() - 0.5) * 0.9);
                if (Math.random() > 0.93)
                    this.makePebble(x + (Math.random() - 0.5), z + (Math.random() - 0.5));
                if (t === 'R')
                    this.makeRock(r, c, x, z, matRock);
                if (t === 'H')
                    this.makeHole(x, z, matHole);
                if (t === 'T')
                    this.makeTree(x, z);
                if (t === 'W')
                    this.makeWater(x, z, matWater);
                if (t === 'A')
                    this.makeAnimal(x, z);
                if (t === 'S') {
                    this.start = { r, c, dir: 1 };
                    this.pos = { ...this.start };
                }
                if (t === 'C') {
                    this.cabin = { r, c };
                    this.makeCottage(x, z);
                }
            }
        }
        this.scatterCountrysideProps(rows, cols);
    }
    scatterCountrysideProps(rows, cols) {
        const minX = -6;
        const maxX = cols * 2 + 4;
        const minZ = -6;
        const maxZ = rows * 2 + 4;
        for (let i = 0; i < 26; i++) {
            const x = minX + Math.random() * (maxX - minX);
            const z = minZ + Math.random() * (maxZ - minZ);
            if (Math.random() > 0.55)
                this.makeTree(x, z, 0.82 + Math.random() * 0.45);
            else
                this.makeBush(x, z, 0.6 + Math.random() * 0.55);
            if (Math.random() > 0.7)
                this.makeFlower(x + (Math.random() - 0.5), z + (Math.random() - 0.5));
        }
        for (let i = 0; i < 8; i++) {
            this.makeFence(minX + 2 + i * 2.6, minZ + 1.4, 0);
            this.makeFence(minX + 2 + i * 2.6, maxZ - 1.2, 0);
        }
        for (let i = 0; i < 6; i++) {
            this.makeFence(minX + 1.1, minZ + 2 + i * 2.5, Math.PI / 2);
            this.makeFence(maxX - 1.1, minZ + 2 + i * 2.5, Math.PI / 2);
        }
        for (let i = 0; i < 7; i++) {
            this.makeWheatPatch(minX + 4 + i * 1.8, maxZ - 3.5 + (Math.random() - 0.5) * 1.2);
            this.makeWheatPatch(maxX - 5 - i * 1.6, minZ + 3 + (Math.random() - 0.5) * 1.2);
        }
    }
    makeBush(x, z, scale = 1) {
        const bush = BABYLON.MeshBuilder.CreateSphere('bush', { diameter: 0.5 * scale }, this.scene);
        bush.position.set(x, 0.2 * scale, z);
        bush.scaling = new BABYLON.Vector3(1.2, 0.9, 1);
        bush.material = this.material('#69b85f', '#4a8d4e');
    }
    makeFlower(x, z) {
        const stem = BABYLON.MeshBuilder.CreateCylinder('flower-stem', { height: 0.24, diameter: 0.03 }, this.scene);
        stem.position.set(x, 0.12, z);
        stem.material = this.material('#4ca652', '#387b3d');
        const petal = BABYLON.MeshBuilder.CreateSphere('flower', { diameter: 0.08 }, this.scene);
        petal.position.set(x, 0.23, z);
        const colors = ['#ff8fc0', '#ffd16d', '#9ed0ff'];
        petal.material = this.material(colors[Math.floor(Math.random() * colors.length)], '#ffffff');
    }
    makeWheatPatch(x, z) {
        for (let i = 0; i < 7; i++) {
            const stalk = BABYLON.MeshBuilder.CreateCylinder('wheat', { height: 0.38 + Math.random() * 0.16, diameter: 0.025 }, this.scene);
            stalk.position.set(x + (Math.random() - 0.5) * 0.8, 0.2, z + (Math.random() - 0.5) * 0.8);
            stalk.material = this.material('#e6cf5c', '#c0a93d');
        }
    }
    makeFence(x, z, rotY) {
        const postA = BABYLON.MeshBuilder.CreateBox('fence-post', { width: 0.08, height: 0.36, depth: 0.08 }, this.scene);
        postA.position.set(x - 0.4 * Math.cos(rotY), 0.18, z - 0.4 * Math.sin(rotY));
        const postB = BABYLON.MeshBuilder.CreateBox('fence-post', { width: 0.08, height: 0.36, depth: 0.08 }, this.scene);
        postB.position.set(x + 0.4 * Math.cos(rotY), 0.18, z + 0.4 * Math.sin(rotY));
        const rail1 = BABYLON.MeshBuilder.CreateBox('fence-rail', { width: 0.85, height: 0.06, depth: 0.05 }, this.scene);
        rail1.position.set(x, 0.22, z);
        rail1.rotation.y = rotY;
        const rail2 = BABYLON.MeshBuilder.CreateBox('fence-rail', { width: 0.85, height: 0.06, depth: 0.05 }, this.scene);
        rail2.position.set(x, 0.3, z);
        rail2.rotation.y = rotY;
        const mat = this.material('#9b7754', '#6f543b');
        postA.material = mat;
        postB.material = mat;
        rail1.material = mat;
        rail2.material = mat;
    }
    makePebble(x, z) {
        const p = BABYLON.MeshBuilder.CreateSphere('pebble', { diameter: 0.22 }, this.scene);
        p.position.set(x, 0.1, z);
        p.scaling = new BABYLON.Vector3(1.3, 0.8, 1);
        p.material = this.material('#b8bcc9', '#8e93a1');
    }
    makeRock(r, c, x, z, mat) {
        const rock = BABYLON.MeshBuilder.CreateSphere(`rock-${r}-${c}`, { diameter: 1.35 }, this.scene);
        rock.position.set(x, 0.65, z);
        rock.scaling = new BABYLON.Vector3(1.2, 0.82, 0.95);
        rock.material = mat;
        const moss = BABYLON.MeshBuilder.CreateSphere(`moss-${r}-${c}`, { diameter: 0.55 }, this.scene);
        moss.position.set(x + 0.25, 1.0, z - 0.12);
        moss.material = this.material('#79b865', '#5f954f');
        this.rockMeshes.set(`${r},${c}`, rock);
    }
    makeHole(x, z, mat) {
        const rim = BABYLON.MeshBuilder.CreateTorus('hole-rim', { diameter: 1.55, thickness: 0.2 }, this.scene);
        rim.position.set(x, 0.06, z);
        rim.material = this.material('#6f5b42', '#4d3a28');
        const pit = BABYLON.MeshBuilder.CreateCylinder('hole', { diameter: 1.28, height: 0.34 }, this.scene);
        pit.position.set(x, 0.02, z);
        pit.material = mat;
    }
    makeTree(x, z, scale = 1) {
        const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', { height: 1.2 * scale, diameter: 0.33 * scale }, this.scene);
        trunk.position.set(x, 0.6 * scale, z);
        trunk.material = this.material('#8b5a2b', '#6e431f');
        const leavesA = BABYLON.MeshBuilder.CreateSphere('leaves-a', { diameter: 1.1 * scale }, this.scene);
        leavesA.position.set(x, 1.45 * scale, z);
        leavesA.material = this.material('#66b95d', '#4b9347');
        const leavesB = BABYLON.MeshBuilder.CreateSphere('leaves-b', { diameter: 0.7 * scale }, this.scene);
        leavesB.position.set(x + 0.25 * scale, 1.8 * scale, z - 0.08 * scale);
        leavesB.material = leavesA.material;
    }
    makeWater(x, z, mat) {
        const w = BABYLON.MeshBuilder.CreateGround('water', { width: 1.9, height: 1.9 }, this.scene);
        w.position.set(x, 0.04, z);
        w.material = mat;
    }
    makeAnimal(x, z) {
        const body = BABYLON.MeshBuilder.CreateSphere('animal', { diameter: 1.0 }, this.scene);
        body.position.set(x, 0.52, z);
        body.material = this.material('#d89b62', '#b8783f');
        const ear = BABYLON.MeshBuilder.CreateSphere('animal-ear', { diameter: 0.28 }, this.scene);
        ear.position.set(x + 0.3, 0.9, z + 0.18);
        ear.material = body.material;
    }
    makeCottage(x, z) {
        const base = BABYLON.MeshBuilder.CreateBox('cottage-base', { width: 2.2, depth: 2.0, height: 1.4 }, this.scene);
        base.position.set(x, 0.7, z);
        base.material = this.material('#ead8be', '#cfb79a');
        const timber1 = BABYLON.MeshBuilder.CreateBox('timber1', { width: 2.2, height: 0.08, depth: 0.09 }, this.scene);
        timber1.position.set(x, 0.95, z + 0.98);
        timber1.material = this.material('#6a4a31', '#4f3825');
        const timber2 = BABYLON.MeshBuilder.CreateBox('timber2', { width: 0.09, height: 1.4, depth: 0.09 }, this.scene);
        timber2.position.set(x - 0.9, 0.7, z + 0.98);
        timber2.material = timber1.material;
        const roof = BABYLON.MeshBuilder.CreateCylinder('cottage-roof', { diameterTop: 0.12, diameterBottom: 2.8, height: 1.45, tessellation: 4 }, this.scene);
        roof.position.set(x, 1.85, z);
        roof.rotation.y = Math.PI / 4;
        roof.material = this.material('#cf9252', '#b06f39');
        const winL = BABYLON.MeshBuilder.CreateBox('window-l', { width: 0.35, height: 0.35, depth: 0.06 }, this.scene);
        winL.position.set(x + 0.65, 0.82, z + 0.97);
        winL.material = this.material('#9fd5ff', '#ffd89c');
        const winR = BABYLON.MeshBuilder.CreateBox('window-r', { width: 0.35, height: 0.35, depth: 0.06 }, this.scene);
        winR.position.set(x - 0.65, 0.82, z + 0.97);
        winR.material = winL.material;
        this.cabinDoor = BABYLON.MeshBuilder.CreateBox('cottage-door', { width: 0.46, height: 0.8, depth: 0.07 }, this.scene);
        this.cabinDoor.position.set(x - 0.05, 0.4, z + 1.01);
        this.cabinDoor.material = this.material('#6f4a2b', '#4d2f18');
        this.makeBush(x + 1.0, z + 0.7, 0.8);
        this.makeBush(x - 1.0, z + 0.7, 0.8);
        this.makeFlower(x + 1.15, z + 1.0);
        this.makeFlower(x - 1.1, z + 1.05);
    }
    createExplorer() {
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
    material(main, glow, alpha = 1) {
        const m = new BABYLON.StandardMaterial(`m-${Math.random()}`, this.scene);
        m.diffuseColor = BABYLON.Color3.FromHexString(main);
        m.emissiveColor = BABYLON.Color3.FromHexString(glow).scale(0.08);
        m.alpha = alpha;
        return m;
    }
    refreshFlow(activeId = '') {
        const lv = this.levels[this.levelIndex];
        this.flow.innerHTML = '';
        this.flow.append(this.fixedNode('START', activeId === 'start', false));
        this.flow.append(this.connector());
        this.nodes.forEach((n, idx) => {
            this.flow.append(this.dynamicNode(n, activeId === n.id, lv));
            if (idx < this.nodes.length - 1)
                this.flow.append(this.connector());
        });
        this.flow.append(this.connector());
        this.flow.append(this.fixedNode('END', activeId === 'end', false));
    }
    fixedNode(title, active, error) {
        const d = document.createElement('div');
        d.className = `node ${active ? 'active' : ''} ${error ? 'error' : ''}`.trim();
        d.innerHTML = `<span class="shape oval">${title}</span>`;
        return d;
    }
    connector() {
        const c = document.createElement('div');
        c.className = 'conn';
        return c;
    }
    dynamicNode(node, active, lv) {
        const d = document.createElement('div');
        const isErr = this.highlightErrorNode === node.id;
        d.className = `node ${active ? 'active' : ''} ${isErr ? 'error' : ''}`.trim();
        d.draggable = this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success';
        d.dataset.id = node.id;
        d.addEventListener('dragstart', (e) => { var _a; return (_a = e.dataTransfer) === null || _a === void 0 ? void 0 : _a.setData('moveNode', node.id); });
        d.addEventListener('dragover', (e) => e.preventDefault());
        d.addEventListener('drop', (e) => {
            var _a;
            e.preventDefault();
            if (!(this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success'))
                return;
            const moveId = (_a = e.dataTransfer) === null || _a === void 0 ? void 0 : _a.getData('moveNode');
            if (!moveId || moveId === node.id)
                return;
            const from = this.nodes.findIndex((n) => n.id === moveId);
            const to = this.nodes.findIndex((n) => n.id === node.id);
            if (from < 0 || to < 0)
                return;
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
            action.onchange = () => (node.action = action.value);
            d.append(action);
        }
        else {
            const shape = document.createElement('span');
            shape.className = 'shape diamond';
            shape.innerHTML = '<span>Decision</span>';
            d.append(shape);
            const cond = document.createElement('select');
            lv.decisions.forEach((dec) => cond.add(new Option(this.decisionLabel(dec), dec)));
            cond.value = node.condition;
            cond.disabled = !(this.runMode === 'idle' || this.runMode === 'failed' || this.runMode === 'success');
            cond.onchange = () => (node.condition = cond.value);
            const t = document.createElement('select');
            ['none', ...lv.actions].forEach((a) => t.add(new Option(`True → ${a === 'none' ? 'Do nothing' : this.actionLabel(a)}`, a)));
            t.value = node.onTrue;
            t.disabled = cond.disabled;
            t.onchange = () => (node.onTrue = t.value);
            const f = document.createElement('select');
            ['none', ...lv.actions].forEach((a) => f.add(new Option(`False → ${a === 'none' ? 'Do nothing' : this.actionLabel(a)}`, a)));
            f.value = node.onFalse;
            f.disabled = cond.disabled;
            f.onchange = () => (node.onFalse = f.value);
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
    actionLabel(a) {
        return {
            walk: 'Walk Forward', left: 'Turn Left', right: 'Turn Right', kickRock: 'Kick Rock Aside', jump: 'Jump',
            chopTree: 'Chop Tree', collectWood: 'Collect Wood', buildBoat: 'Build Boat', paddleAcross: 'Paddle Across',
            offerSnack: 'Offer Snack', enterCabin: 'Enter Cabin'
        }[a];
    }
    decisionLabel(d) {
        return {
            rockAhead: 'Rock ahead?', holeAhead: 'Hole ahead?', treeAhead: 'Tree ahead?', streamAhead: 'Stream ahead?',
            animalAhead: 'Animal ahead?', enoughWood: 'Enough wood?', exitAhead: 'Exit ahead?'
        }[d];
    }
    front(state = this.pos) {
        const delta = [[-1, 0], [0, 1], [1, 0], [0, -1]][state.dir];
        return { r: state.r + delta[0], c: state.c + delta[1] };
    }
    cell(r, c) {
        const g = this.levelTemplate;
        if (r < 0 || c < 0 || r >= g.length || c >= g[0].length)
            return 'R';
        return g[r][c];
    }
    setCell(r, c, tile) {
        const rows = this.levelTemplate.map((line) => line.split(''));
        rows[r][c] = tile;
        this.levelTemplate = rows.map((r) => r.join(''));
    }
    async runAll() {
        if (this.runMode === 'running' || this.runMode === 'stepping')
            return;
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
            if (!ok)
                break;
            await this.wait(260, token);
        }
        if (this.runMode === 'running')
            this.runMode = 'idle';
    }
    async stepOnce() {
        if (this.runMode === 'running' || this.runMode === 'stepping')
            return;
        if (this.pointer >= this.nodes.length) {
            this.setStatus('No more blocks. Add more or Reset to try again.');
            return;
        }
        this.runMode = 'stepping';
        const token = ++this.runnerToken;
        const ok = await this.executeAtPointer(token);
        this.runMode = ok ? 'idle' : this.runMode;
    }
    async executeAtPointer(token) {
        const node = this.nodes[this.pointer];
        if (!node)
            return false;
        this.highlightErrorNode = '';
        this.highlightBranch = '';
        this.stepEl.textContent = `Step ${this.pointer + 1}`;
        this.refreshFlow(node.id);
        let result = { ok: true };
        const before = { r: this.pos.r, c: this.pos.c, dir: this.pos.dir };
        let executedAction = node.type === 'process' ? node.action : 'none';
        if (node.type === 'process') {
            result = await this.performAction(node.action, node.id, token);
        }
        else {
            const yes = this.evaluateDecision(node.condition);
            this.highlightBranch = yes ? 'true' : 'false';
            this.refreshFlow(node.id);
            this.setStatus(`${this.decisionLabel(node.condition)} ${yes ? 'Yes' : 'No'}.`);
            await this.wait(180, token);
            const action = yes ? node.onTrue : node.onFalse;
            executedAction = action;
            this.setStatus(`Decision chose: ${action === 'none' ? 'Do nothing' : this.actionLabel(action)}.`);
            if (action !== 'none')
                result = await this.performAction(action, node.id, token);
            console.log('[FlowExec]', { step: this.pointer + 1, blockType: 'decision', decision: node.condition, decisionResult: yes, actionExecuted: action, before, after: { r: this.pos.r, c: this.pos.c, dir: this.pos.dir } });
        }
        if (node.type === 'process') {
            console.log('[FlowExec]', { step: this.pointer + 1, blockType: 'process', actionExecuted: executedAction, before, after: { r: this.pos.r, c: this.pos.c, dir: this.pos.dir } });
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
    evaluateDecision(d) {
        const f = this.front();
        const ahead = this.cell(f.r, f.c);
        if (d === 'rockAhead')
            return ahead === 'R';
        if (d === 'holeAhead')
            return ahead === 'H';
        if (d === 'treeAhead')
            return ahead === 'T';
        if (d === 'streamAhead')
            return ahead === 'W';
        if (d === 'animalAhead')
            return ahead === 'A';
        if (d === 'enoughWood')
            return this.wood > 0;
        if (d === 'exitAhead')
            return ahead === 'C';
        return false;
    }
    async performAction(action, _nodeId, token) {
        if (token !== this.runnerToken)
            return { ok: false, message: 'Run interrupted.' };
        if (action === 'left' || action === 'right') {
            this.pos.dir = ((this.pos.dir + (action === 'right' ? 1 : 3)) % 4);
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
            if (this.evaluateDecision('exitAhead'))
                return { ok: false, message: 'The cabin is still ahead — keep going.' };
            return { ok: false, message: 'You tried to enter the cabin too early.' };
        }
        const f = this.front();
        const ahead = this.cell(f.r, f.c);
        if (action === 'walk') {
            if (ahead === 'R')
                return { ok: false, message: 'A big rock blocks the trail. Try Kick Rock Aside first.' };
            if (ahead === 'H')
                return { ok: false, message: 'That step would fall into a hole. Try Jump.' };
            if (ahead === 'T')
                return { ok: false, message: 'A tree is in the way. Try Chop Tree first.' };
            if (ahead === 'W')
                return { ok: false, message: 'That is a stream. Build a boat, then paddle across.' };
            if (ahead === 'A')
                return { ok: false, message: 'A forest friend blocks the path. Offer Snack to pass.' };
            await this.moveTo(f.r, f.c, token, false);
            if (this.pos.r === this.cabin.r && this.pos.c === this.cabin.c && !this.enteredCabin) {
                this.setStatus('Cabin reached, but the algorithm is incomplete. Add Enter Cabin.', 'bad');
            }
            return { ok: true };
        }
        if (action === 'kickRock') {
            if (ahead !== 'R')
                return { ok: false, message: 'There’s no rock to kick.' };
            await this.kickRockAside(f.r, f.c, token);
            this.setCell(f.r, f.c, '.');
            this.drawMiniMap();
            this.setStatus('Nice kick! The rock rolled into the grass.');
            return { ok: true };
        }
        if (action === 'jump') {
            if (ahead !== 'H')
                return { ok: false, message: 'Jump is best for crossing holes.' };
            this.setCell(f.r, f.c, '.');
            await this.moveTo(f.r, f.c, token, true);
            return { ok: true };
        }
        if (action === 'chopTree') {
            if (ahead !== 'T')
                return { ok: false, message: 'No tree ahead to chop right now.' };
            this.setCell(f.r, f.c, '.');
            this.setStatus('Chop! The trail is open.');
            return { ok: true };
        }
        if (action === 'collectWood') {
            if (ahead !== '.' && ahead !== 'W' && ahead !== 'C')
                return { ok: false, message: 'There is no loose wood to collect here.' };
            this.wood += 1;
            this.updateHUD();
            this.setStatus('Wood collected. Great planning!');
            return { ok: true };
        }
        if (action === 'buildBoat') {
            if (this.wood <= 0)
                return { ok: false, message: 'You need wood before building a boat.' };
            this.wood -= 1;
            this.hasBoat = true;
            this.updateHUD();
            this.setStatus('Boat ready! Now paddle across the stream.');
            return { ok: true };
        }
        if (action === 'paddleAcross') {
            if (ahead !== 'W')
                return { ok: false, message: 'Paddle Across only works when a stream is ahead.' };
            if (!this.hasBoat)
                return { ok: false, message: 'Build a boat first, then paddle.' };
            this.hasBoat = false;
            await this.moveTo(f.r, f.c, token, true);
            this.setStatus('Smooth crossing!');
            return { ok: true };
        }
        if (action === 'offerSnack') {
            if (ahead !== 'A')
                return { ok: false, message: 'No animal ahead right now for a snack break.' };
            this.setCell(f.r, f.c, '.');
            this.setStatus('The animal happily moved aside 🐾');
            return { ok: true };
        }
        return { ok: true };
    }
    async kickRockAside(r, c, token) {
        const key = `${r},${c}`;
        const rock = this.rockMeshes.get(key);
        // kick motion cue on explorer
        await this.animate(this.player, 'rotation.x', 0, 0.12, 4, token);
        await this.animate(this.player, 'rotation.x', 0.12, 0, 5, token);
        if (rock) {
            const side = this.pos.dir === 0 || this.pos.dir === 2 ? 1 : -1;
            const target = rock.position.clone();
            if (this.pos.dir === 0 || this.pos.dir === 2)
                target.x += side * 1.5;
            else
                target.z += side * 1.5;
            await this.animate(rock, 'position.y', rock.position.y, rock.position.y + 0.25, 5, token);
            await this.animate(rock, 'position', rock.position.clone(), target, 10, token);
            await this.animate(rock, 'rotation.z', 0, 1.3 * side, 10, token);
            await this.animate(rock, 'position.y', rock.position.y + 0.25, 0.25, 6, token);
            rock.dispose();
            this.rockMeshes.delete(key);
        }
        this.spawnDust(this.pos.c * 2, this.pos.r * 2);
    }
    spawnDust(x, z) {
        for (let i = 0; i < 5; i++) {
            const puff = BABYLON.MeshBuilder.CreateSphere(`dust-${Math.random()}`, { diameter: 0.12 + Math.random() * 0.08 }, this.scene);
            puff.position.set(x + (Math.random() - 0.5) * 0.35, 0.2 + Math.random() * 0.15, z + (Math.random() - 0.5) * 0.35);
            puff.material = this.material('#d3b38e', '#b79067', 0.7);
            setTimeout(() => puff.dispose(), 420);
        }
    }
    async moveTo(r, c, token, arc) {
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
    async failureNudge(token) {
        const original = this.player.rotation.z;
        await this.animate(this.player, 'rotation.z', original, 0.2, 5, token);
        await this.animate(this.player, 'rotation.z', 0.2, -0.2, 6, token);
        await this.animate(this.player, 'rotation.z', -0.2, 0, 6, token);
        await this.wait(250, token);
    }
    animate(target, prop, from, to, frames, token) {
        if (token !== this.runnerToken)
            return Promise.resolve();
        return BABYLON.Animation.CreateAndStartAnimation(`anim-${Math.random()}`, target, prop, 30, frames, from, to, 0);
    }
    wait(ms, token) {
        return new Promise((resolve) => {
            const started = this.runnerToken;
            setTimeout(() => {
                if (token === started && token === this.runnerToken)
                    resolve();
                else
                    resolve();
            }, ms);
        });
    }
    validateSync() {
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
    snapPlayerToState() {
        this.player.position = new BABYLON.Vector3(this.pos.c * 2, 0.78, this.pos.r * 2);
        this.player.rotation = new BABYLON.Vector3(0, this.pos.dir * (Math.PI / 2), 0);
    }
    onSuccess() {
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
    computeStars() {
        let stars = 0;
        if (this.enteredCabin)
            stars++;
        if (this.nodes.length <= this.levels[this.levelIndex].limit)
            stars++;
        if (this.nodes.length <= this.levels[this.levelIndex].perfect)
            stars++;
        return stars;
    }
    resetLevel() {
        this.loadLevel(this.levelIndex, false);
    }
    setStatus(text, type = '') {
        this.statusEl.className = `status ${type}`.trim();
        this.statusEl.textContent = text;
    }
    updateHUD() {
        const lv = this.levels[this.levelIndex];
        this.invEl.textContent = `Wood: ${this.wood}`;
        this.limitEl.textContent = `Blocks Remaining: ${Math.max(0, lv.limit - this.nodes.length)}`;
        this.starEl.textContent = `⭐ ${this.enteredCabin ? this.computeStars() : 0}/3`;
    }
    drawMiniMap() {
        const ctx = this.miniCanvas.getContext('2d');
        const g = this.levelTemplate;
        const rows = g.length;
        const cols = g[0].length;
        const cell = Math.min(this.miniCanvas.width / cols, this.miniCanvas.height / rows);
        ctx.clearRect(0, 0, this.miniCanvas.width, this.miniCanvas.height);
        const color = {
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
