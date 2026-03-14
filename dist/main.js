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
        this.nodes = [];
        this.runnerToken = 0;
        this.runMode = 'idle';
        this.pointer = 0;
        this.highlightErrorNode = '';
        this.highlightBranch = '';
        this.levelIndex = 0;
        this.wood = 0;
        this.hasBoat = false;
        this.enteredCabin = false;
        this.traveledIndices = [];
        this.checkpointIndex = 0;
        this.checkpoints = [];
        this.segmentKinds = [];
        this.obstacleMeshes = new Map();
        this.cabinIndex = 0;
        this.cabinEntranceIndex = 0;
        this.levels = [
            {
                name: 'Level 1 · Basic obstacle reactions',
                instruction: 'Use Rock/Hole decisions and actions to cross, then Enter Cabin.',
                limit: 6,
                perfect: 5,
                path: 'S.R.H.C',
                actions: ['walk', 'left', 'right', 'kickRock', 'jump', 'enterCabin'],
                decisions: ['rockAhead', 'holeAhead']
            },
            {
                name: 'Level 2 · Resources and streams',
                instruction: 'Chop and collect wood, build boat, paddle stream, then Enter Cabin.',
                limit: 8,
                perfect: 7,
                path: 'S.TW...C',
                actions: ['walk', 'chopTree', 'collectWood', 'buildBoat', 'paddleAcross', 'enterCabin'],
                decisions: ['treeAhead', 'streamAhead', 'enoughWood']
            },
            {
                name: 'Level 3 · Multi-step planning',
                instruction: 'Combine resources, animal handling, hole jump, and explicit Enter Cabin.',
                limit: 10,
                perfect: 9,
                path: 'S.TWAW.H.C',
                actions: ['walk', 'chopTree', 'collectWood', 'buildBoat', 'paddleAcross', 'offerSnack', 'jump', 'enterCabin', 'kickRock'],
                decisions: ['treeAhead', 'streamAhead', 'enoughWood', 'animalAhead', 'holeAhead', 'exitAhead', 'rockAhead']
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
        scene.clearColor = new BABYLON.Color4(0.7, 0.88, 1, 1);
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP;
        scene.fogDensity = 0.009;
        scene.fogColor = new BABYLON.Color3(0.79, 0.9, 1);
        const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
        hemi.intensity = 0.78;
        const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.35, -1, -0.18), scene);
        sun.position = new BABYLON.Vector3(20, 24, -8);
        sun.intensity = 1.02;
        const arc = new BABYLON.ArcRotateCamera('storybook', -Math.PI / 2, 1.04, 27, new BABYLON.Vector3(8, 0, 0), scene);
        arc.lowerAlphaLimit = arc.upperAlphaLimit = arc.alpha;
        arc.lowerBetaLimit = arc.upperBetaLimit = arc.beta;
        arc.lowerRadiusLimit = arc.upperRadiusLimit = arc.radius;
        arc.inputs.clear();
        this.camera = arc;
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
        if (!keepFlow)
            this.nodes = [];
        this.wood = 0;
        this.hasBoat = false;
        this.enteredCabin = false;
        this.traveledIndices = [];
        this.levelEl.textContent = this.levels[index].name;
        this.buildPathWorld(this.levels[index].path);
        this.player = this.createExplorer();
        this.snapPlayerToCheckpoint();
        this.refreshFlow();
        this.updateHUD();
        this.drawMiniMap();
        this.setStatus(this.levels[index].instruction);
    }
    disposeWorld() {
        this.scene.meshes.slice().forEach((m) => m.dispose());
        this.obstacleMeshes.clear();
    }
    parsePath(path) {
        return path.split('').filter((ch) => ch !== '.').map((ch) => {
            if (ch === 'S')
                return 'start';
            if (ch === 'C')
                return 'cabin';
            if (ch === 'R')
                return 'rock';
            if (ch === 'H')
                return 'hole';
            if (ch === 'T')
                return 'tree';
            if (ch === 'W')
                return 'stream';
            if (ch === 'A')
                return 'animal';
            return 'path';
        });
    }
    buildPathWorld(rawPath) {
        this.segmentKinds = this.parsePath(rawPath);
        this.checkpoints = [];
        const count = this.segmentKinds.length;
        const width = count * 3.2 + 26;
        const terrain = BABYLON.MeshBuilder.CreateGround('terrain', { width, height: 30 }, this.scene);
        terrain.position.set((count - 1) * 1.6, -0.04, 0);
        terrain.material = this.material('#82c36e', '#68a95a');
        const pathRibbon = [];
        for (let i = 0; i < count; i++) {
            const x = i * 3.2;
            const z = Math.sin(i * 0.85) * 2.1;
            this.checkpoints.push(new BABYLON.Vector3(x, 0.78, z));
            const tile = BABYLON.MeshBuilder.CreateGround(`path-${i}`, { width: 2.8, height: 2.1 }, this.scene);
            tile.position.set(x, 0, z);
            tile.rotation.y = Math.sin(i * 0.4) * 0.1;
            tile.material = this.material('#c69b67', '#ab7f4f');
            pathRibbon.push(tile);
            if (Math.random() > 0.4)
                this.makeBush(x + (Math.random() - 0.5) * 3.6, z + (Math.random() - 0.5) * 2.8);
            if (Math.random() > 0.65)
                this.makeFlower(x + (Math.random() - 0.5) * 2.5, z + (Math.random() - 0.5) * 2.2);
            if (Math.random() > 0.75)
                this.makePebble(x + (Math.random() - 0.5) * 3.8, z + (Math.random() - 0.5) * 3.2);
        }
        this.makeFences(count);
        for (let i = 0; i < count; i++)
            this.spawnSegmentVisual(i, this.segmentKinds[i]);
        this.checkpointIndex = 0;
        this.cabinIndex = this.segmentKinds.findIndex((s) => s === 'cabin');
        this.cabinEntranceIndex = Math.max(0, this.cabinIndex - 1);
        const center = this.checkpoints[Math.floor(this.checkpoints.length / 2)];
        this.camera.target = center;
    }
    spawnSegmentVisual(index, kind) {
        const p = this.checkpoints[index];
        if (kind === 'rock') {
            const rock = BABYLON.MeshBuilder.CreateSphere(`rock-${index}`, { diameter: 1.4 }, this.scene);
            rock.scaling = new BABYLON.Vector3(1.2, 0.82, 0.95);
            rock.position.set(p.x, 0.66, p.z);
            rock.material = this.material('#9fa7b5', '#808999');
            this.obstacleMeshes.set(index, rock);
        }
        if (kind === 'hole') {
            const hole = BABYLON.MeshBuilder.CreateCylinder(`hole-${index}`, { diameter: 1.45, height: 0.15 }, this.scene);
            hole.position.set(p.x, -0.06, p.z);
            hole.material = this.material('#3f322c', '#241d1b');
            this.obstacleMeshes.set(index, hole);
        }
        if (kind === 'tree') {
            const trunk = BABYLON.MeshBuilder.CreateCylinder(`tree-trunk-${index}`, { height: 1.2, diameter: 0.34 }, this.scene);
            trunk.position.set(p.x, 0.6, p.z);
            trunk.material = this.material('#8d6747', '#6e4e35');
            const canopyA = BABYLON.MeshBuilder.CreateSphere(`tree-a-${index}`, { diameter: 1.2 }, this.scene);
            canopyA.position.set(p.x - 0.2, 1.45, p.z + 0.1);
            canopyA.material = this.material('#72b964', '#569c4f');
            const canopyB = BABYLON.MeshBuilder.CreateSphere(`tree-b-${index}`, { diameter: 1.05 }, this.scene);
            canopyB.position.set(p.x + 0.22, 1.52, p.z - 0.12);
            canopyB.material = this.material('#6eb760', '#4f9447');
            const tree = BABYLON.Mesh.MergeMeshes([trunk, canopyA, canopyB], true, false, undefined, false, true);
            this.obstacleMeshes.set(index, tree);
        }
        if (kind === 'stream') {
            const water = BABYLON.MeshBuilder.CreateGround(`stream-${index}`, { width: 2.8, height: 1.9 }, this.scene);
            water.position.set(p.x, 0.01, p.z);
            water.material = this.material('#7bd3ff', '#4daeea', 0.92);
            this.obstacleMeshes.set(index, water);
        }
        if (kind === 'animal') {
            const body = BABYLON.MeshBuilder.CreateSphere(`animal-body-${index}`, { diameter: 1.1 }, this.scene);
            body.scaling = new BABYLON.Vector3(1.25, 0.72, 0.85);
            body.position.set(p.x, 0.6, p.z);
            body.material = this.material('#d5a071', '#b98255');
            this.obstacleMeshes.set(index, body);
        }
        if (kind === 'cabin') {
            this.makeCottage(index);
        }
    }
    makeCottage(index) {
        const p = this.checkpoints[index];
        const base = BABYLON.MeshBuilder.CreateBox('cabin-base', { width: 2.6, height: 1.7, depth: 2.2 }, this.scene);
        base.position.set(p.x, 0.85, p.z);
        base.material = this.material('#b8875e', '#906645');
        const roof = BABYLON.MeshBuilder.CreateCylinder('cabin-roof', { diameterTop: 0, diameterBottom: 3.2, height: 1.2, tessellation: 4 }, this.scene);
        roof.rotation.z = Math.PI / 2;
        roof.rotation.y = Math.PI / 4;
        roof.position.set(p.x, 2.0, p.z);
        roof.material = this.material('#b86b47', '#8f4f34');
        this.cabinDoor = BABYLON.MeshBuilder.CreateBox('cabin-door', { width: 0.55, height: 1.05, depth: 0.08 }, this.scene);
        this.cabinDoor.position.set(p.x - 1.26, 0.55, p.z);
        this.cabinDoor.material = this.material('#7e5438', '#624027');
        const win = BABYLON.MeshBuilder.CreateBox('cabin-win', { width: 0.4, height: 0.33, depth: 0.08 }, this.scene);
        win.position.set(p.x, 1.0, p.z + 1.1);
        win.material = this.material('#ffd285', '#f6b85c', 0.95);
    }
    makeFences(count) {
        const minX = -4;
        const maxX = this.checkpoints[count - 1].x + 4;
        for (let i = 0; i < 10; i++) {
            this.makeFence(minX + i * ((maxX - minX) / 9), -7.4, 0);
            this.makeFence(minX + i * ((maxX - minX) / 9), 7.4, 0);
        }
    }
    createExplorer() {
        const body = BABYLON.MeshBuilder.CreateCapsule('explorer-body', { height: 1.4, radius: 0.28 }, this.scene);
        body.material = this.material('#4f86ff', '#385fd4');
        const head = BABYLON.MeshBuilder.CreateSphere('explorer-head', { diameter: 0.56 }, this.scene);
        head.position.y = 1.06;
        head.material = this.material('#ffe5cb', '#f0c89f');
        const group = BABYLON.Mesh.MergeMeshes([body, head], true, false, undefined, false, true);
        group.position = this.checkpoints[0].clone();
        group.rotation = new BABYLON.Vector3(0, 0, 0);
        return group;
    }
    refreshFlow(activeId = '') {
        this.flow.innerHTML = '';
        const locked = this.runMode === 'running' || this.runMode === 'stepping';
        const start = document.createElement('div');
        start.className = 'node';
        start.innerHTML = '<strong style="color:#3f69ff">START</strong>';
        this.flow.append(start);
        this.nodes.forEach((node, i) => {
            const d = this.buildNode(node, node.id === activeId, locked);
            this.flow.append(d);
            if (i < this.nodes.length - 1) {
                const conn = document.createElement('div');
                conn.className = `conn ${node.id === activeId ? 'active' : ''}`;
                this.flow.append(conn);
            }
        });
        const end = document.createElement('div');
        end.className = 'node';
        end.innerHTML = '<strong style="color:#8b5cf6">END</strong>';
        this.flow.append(end);
    }
    buildNode(node, active, locked) {
        const d = document.createElement('div');
        d.className = `node ${active ? 'active' : ''} ${this.highlightErrorNode === node.id ? 'error' : ''}`.trim();
        const drag = document.createElement('span');
        drag.className = 'drag';
        drag.textContent = '⋮⋮';
        d.append(drag);
        if (node.type === 'process') {
            const tag = document.createElement('strong');
            tag.textContent = 'Process';
            const select = document.createElement('select');
            this.levels[this.levelIndex].actions.forEach((a) => select.add(new Option(this.actionLabel(a), a)));
            select.value = node.action;
            select.disabled = locked;
            select.onchange = () => (node.action = select.value);
            d.append(tag, select);
        }
        else {
            const tag = document.createElement('strong');
            tag.textContent = 'Decision';
            const cond = document.createElement('select');
            this.levels[this.levelIndex].decisions.forEach((c) => cond.add(new Option(this.decisionLabel(c), c)));
            cond.value = node.condition;
            cond.disabled = locked;
            cond.onchange = () => (node.condition = cond.value);
            const t = document.createElement('select');
            ['none', ...this.levels[this.levelIndex].actions].forEach((a) => t.add(new Option(`True → ${a === 'none' ? 'Do nothing' : this.actionLabel(a)}`, a)));
            t.value = node.onTrue;
            t.disabled = locked;
            t.onchange = () => (node.onTrue = t.value);
            const f = document.createElement('select');
            ['none', ...this.levels[this.levelIndex].actions].forEach((a) => f.add(new Option(`False → ${a === 'none' ? 'Do nothing' : this.actionLabel(a)}`, a)));
            f.value = node.onFalse;
            f.disabled = locked;
            f.onchange = () => (node.onFalse = f.value);
            const badge = document.createElement('span');
            badge.style.fontWeight = '700';
            badge.style.color = this.highlightBranch === 'true' && active ? '#16a34a' : this.highlightBranch === 'false' && active ? '#d97706' : '#5b6ea7';
            badge.textContent = this.highlightBranch && active ? `Branch: ${this.highlightBranch.toUpperCase()}` : 'Branch: -';
            d.append(tag, cond, t, f, badge);
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
            walk: 'Walk Forward',
            left: 'Turn Left',
            right: 'Turn Right',
            kickRock: 'KICK ROCK',
            jump: 'Jump',
            chopTree: 'Chop Tree',
            collectWood: 'Collect Wood',
            buildBoat: 'Build Boat',
            paddleAcross: 'Paddle Across',
            offerSnack: 'Offer Snack',
            enterCabin: 'Enter Cabin'
        }[a];
    }
    decisionLabel(d) {
        return {
            rockAhead: 'Rock ahead?',
            holeAhead: 'Hole ahead?',
            treeAhead: 'Tree ahead?',
            streamAhead: 'Stream ahead?',
            animalAhead: 'Animal ahead?',
            enoughWood: 'Enough wood?',
            exitAhead: 'Exit ahead?'
        }[d];
    }
    getAheadIndex() {
        return this.checkpointIndex + 1;
    }
    getSegment(index) {
        if (index < 0 || index >= this.segmentKinds.length)
            return 'void';
        return this.segmentKinds[index];
    }
    async runAll() {
        if (this.runMode === 'running' || this.runMode === 'stepping')
            return;
        if (this.nodes.length === 0)
            return this.setStatus('Add a few flowchart blocks first, then press Run.');
        if (this.nodes.length > this.levels[this.levelIndex].limit)
            return this.setStatus('Algorithm too long. Try solving it with fewer steps.', 'bad');
        this.runMode = 'running';
        const token = ++this.runnerToken;
        while (this.runMode === 'running' && this.pointer < this.nodes.length) {
            const ok = await this.executeAtPointer(token);
            if (!ok)
                break;
            await this.wait(240, token);
        }
        if (this.runMode === 'running')
            this.runMode = 'idle';
    }
    async stepOnce() {
        if (this.runMode === 'running' || this.runMode === 'stepping')
            return;
        if (this.pointer >= this.nodes.length)
            return this.setStatus('No more blocks. Add more or Reset to try again.');
        this.runMode = 'stepping';
        const token = ++this.runnerToken;
        const ok = await this.executeAtPointer(token);
        this.runMode = ok ? 'idle' : this.runMode;
    }
    async executeAtPointer(token) {
        var _a;
        const node = this.nodes[this.pointer];
        if (!node)
            return false;
        this.highlightErrorNode = '';
        this.highlightBranch = '';
        this.stepEl.textContent = `Step ${this.pointer + 1}`;
        this.refreshFlow(node.id);
        const before = { index: this.checkpointIndex, pos: (_a = this.checkpoints[this.checkpointIndex]) === null || _a === void 0 ? void 0 : _a.clone() };
        let result = { ok: true };
        let executedAction = node.type === 'process' ? node.action : 'none';
        if (node.type === 'process') {
            result = await this.performAction(node.action, token);
        }
        else {
            const yes = this.evaluateDecision(node.condition);
            this.highlightBranch = yes ? 'true' : 'false';
            this.refreshFlow(node.id);
            await this.wait(160, token);
            const action = yes ? node.onTrue : node.onFalse;
            executedAction = action;
            if (action !== 'none')
                result = await this.performAction(action, token);
            console.log('[FlowExec]', {
                step: this.pointer + 1,
                blockType: 'decision',
                decision: node.condition,
                decisionResult: yes,
                actionExecuted: action,
                beforeIndex: before.index,
                afterIndex: this.checkpointIndex
            });
        }
        if (node.type === 'process') {
            console.log('[FlowExec]', {
                step: this.pointer + 1,
                blockType: 'process',
                actionExecuted: executedAction,
                beforeIndex: before.index,
                afterIndex: this.checkpointIndex
            });
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
        this.drawMiniMap();
        this.updateHUD();
        return true;
    }
    evaluateDecision(d) {
        const ahead = this.getSegment(this.getAheadIndex());
        if (d === 'rockAhead')
            return ahead === 'rock';
        if (d === 'holeAhead')
            return ahead === 'hole';
        if (d === 'treeAhead')
            return ahead === 'tree';
        if (d === 'streamAhead')
            return ahead === 'stream';
        if (d === 'animalAhead')
            return ahead === 'animal';
        if (d === 'enoughWood')
            return this.wood > 0;
        if (d === 'exitAhead')
            return ahead === 'cabin';
        return false;
    }
    async performAction(action, token) {
        var _a, _b;
        if (token !== this.runnerToken)
            return { ok: false, message: 'Run interrupted.' };
        if (action === 'left' || action === 'right') {
            const delta = action === 'right' ? 0.45 : -0.45;
            await this.animate(this.player, 'rotation.y', this.player.rotation.y, this.player.rotation.y + delta, 8, token);
            this.setStatus(action === 'right' ? 'Turned right.' : 'Turned left.');
            return { ok: true };
        }
        if (action === 'enterCabin') {
            if (this.checkpointIndex === this.cabinEntranceIndex) {
                this.enteredCabin = true;
                await this.animate(this.cabinDoor, 'rotation.y', this.cabinDoor.rotation.y, -1.15, 16, token);
                await this.moveToIndex(this.cabinIndex, token, false);
                this.onSuccess();
                return { ok: true };
            }
            return { ok: false, message: 'The cabin is still ahead — keep going.' };
        }
        const aheadIndex = this.getAheadIndex();
        const ahead = this.getSegment(aheadIndex);
        if (action === 'walk') {
            if (ahead === 'void')
                return { ok: false, message: 'Cannot move forward from here.' };
            if (['rock', 'hole', 'tree', 'stream', 'animal'].includes(ahead)) {
                return { ok: false, message: `Path blocked ahead by ${ahead}.` };
            }
            await this.moveToIndex(aheadIndex, token, false);
            if (this.checkpointIndex === this.cabinEntranceIndex)
                this.setStatus('You are at the cabin entrance. Use Enter Cabin.');
            return { ok: true };
        }
        if (action === 'kickRock') {
            if (ahead !== 'rock')
                return { ok: false, message: 'There’s no rock to kick.' };
            const mesh = this.obstacleMeshes.get(aheadIndex);
            if (!mesh)
                return { ok: false, message: 'Cannot kick rock right now.' };
            await this.animate(this.player, 'position.x', this.player.position.x, this.player.position.x + 0.35, 5, token);
            await this.animate(this.player, 'position.x', this.player.position.x + 0.35, this.player.position.x, 5, token);
            const target = mesh.position.clone();
            target.z += 1.8;
            await this.animate(mesh, 'position', mesh.position.clone(), target, 11, token);
            this.segmentKinds[aheadIndex] = 'path';
            this.setStatus('Rock kicked aside. Path is clear.');
            return { ok: true };
        }
        if (action === 'jump') {
            if (ahead !== 'hole')
                return { ok: false, message: 'Jump only works when a hole is ahead.' };
            const landing = aheadIndex + 1;
            const landingKind = this.getSegment(landing);
            if (landingKind === 'void' || ['rock', 'hole', 'tree', 'stream', 'animal'].includes(landingKind)) {
                return { ok: false, message: 'No safe landing point after the hole.' };
            }
            await this.moveToIndex(landing, token, true);
            return { ok: true };
        }
        if (action === 'chopTree') {
            if (ahead !== 'tree')
                return { ok: false, message: 'No tree ahead to chop right now.' };
            this.segmentKinds[aheadIndex] = 'path';
            (_a = this.obstacleMeshes.get(aheadIndex)) === null || _a === void 0 ? void 0 : _a.dispose();
            this.obstacleMeshes.delete(aheadIndex);
            this.setStatus('Chop! The trail is open.');
            return { ok: true };
        }
        if (action === 'collectWood') {
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
            this.setStatus('Boat ready!');
            return { ok: true };
        }
        if (action === 'paddleAcross') {
            if (ahead !== 'stream')
                return { ok: false, message: 'Paddle Across only works when a stream is ahead.' };
            if (!this.hasBoat)
                return { ok: false, message: 'Build a boat first, then paddle.' };
            this.hasBoat = false;
            this.segmentKinds[aheadIndex] = 'path';
            await this.moveToIndex(aheadIndex, token, true);
            return { ok: true };
        }
        if (action === 'offerSnack') {
            if (ahead !== 'animal')
                return { ok: false, message: 'No animal ahead right now.' };
            this.segmentKinds[aheadIndex] = 'path';
            (_b = this.obstacleMeshes.get(aheadIndex)) === null || _b === void 0 ? void 0 : _b.dispose();
            this.obstacleMeshes.delete(aheadIndex);
            this.setStatus('The animal happily moves aside.');
            return { ok: true };
        }
        return { ok: true };
    }
    async moveToIndex(index, token, jumpArc) {
        const startPos = this.player.position.clone();
        const next = this.checkpoints[index].clone();
        const dir = next.subtract(startPos).normalize();
        const targetYaw = Math.atan2(dir.x, dir.z);
        await this.animate(this.player, 'rotation.y', this.player.rotation.y, targetYaw, 10, token);
        if (jumpArc) {
            await this.animate(this.player, 'position.y', this.player.position.y, this.player.position.y + 1.0, 8, token);
            await this.animate(this.player, 'position.y', this.player.position.y + 1.0, next.y, 8, token);
        }
        await this.animate(this.player, 'position', startPos, next, 20, token);
        this.checkpointIndex = index;
        this.traveledIndices.push(index);
        this.drawMiniMap();
    }
    async failureNudge(token) {
        await this.animate(this.player, 'rotation.z', 0, 0.22, 5, token);
        await this.animate(this.player, 'rotation.z', 0.22, -0.22, 8, token);
        await this.animate(this.player, 'rotation.z', -0.22, 0, 5, token);
        await this.wait(220, token);
    }
    animate(target, prop, from, to, frames, token) {
        if (token !== this.runnerToken)
            return Promise.resolve();
        return BABYLON.Animation.CreateAndStartAnimation(`anim-${Math.random()}`, target, prop, 30, frames, from, to, 0);
    }
    wait(ms, token) {
        return new Promise((resolve) => {
            const id = this.runnerToken;
            setTimeout(() => resolve(void (token === id)), ms);
        });
    }
    snapPlayerToCheckpoint() {
        this.checkpointIndex = 0;
        this.player.position = this.checkpoints[0].clone();
        this.player.rotation = new BABYLON.Vector3(0, 0, 0);
        this.traveledIndices = [0];
    }
    onSuccess() {
        this.runMode = 'success';
        this.flow.querySelectorAll('.node').forEach((n) => n.classList.add('success'));
        this.setStatus(`Success! You reached home and entered the cabin. ⭐ ${this.computeStars()}/3`, 'good');
        this.updateHUD();
        if (this.levelIndex < this.levels.length - 1)
            setTimeout(() => this.loadLevel(this.levelIndex + 1), 1400);
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
        ctx.clearRect(0, 0, this.miniCanvas.width, this.miniCanvas.height);
        if (this.checkpoints.length === 0)
            return;
        const xs = this.checkpoints.map((p) => p.x);
        const zs = this.checkpoints.map((p) => p.z);
        const minX = Math.min(...xs) - 2;
        const maxX = Math.max(...xs) + 2;
        const minZ = Math.min(...zs) - 2;
        const maxZ = Math.max(...zs) + 2;
        const proj = (p) => {
            const x = ((p.x - minX) / (maxX - minX)) * (this.miniCanvas.width - 20) + 10;
            const y = ((p.z - minZ) / (maxZ - minZ)) * (this.miniCanvas.height - 20) + 10;
            return { x, y };
        };
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#c89c69';
        ctx.beginPath();
        this.checkpoints.forEach((p, i) => {
            const q = proj(p);
            if (i === 0)
                ctx.moveTo(q.x, q.y);
            else
                ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
        this.segmentKinds.forEach((k, i) => {
            if (k === 'path' || k === 'start' || k === 'cabin')
                return;
            const q = proj(this.checkpoints[i]);
            ctx.fillStyle = { rock: '#7f8797', hole: '#2f2b31', tree: '#49a64d', stream: '#57c0f5', animal: '#c58957' }[k] || '#999';
            ctx.beginPath();
            ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
        this.traveledIndices.forEach((i) => {
            const q = proj(this.checkpoints[i]);
            ctx.fillStyle = 'rgba(255,255,255,.5)';
            ctx.beginPath();
            ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
        const cur = proj(this.checkpoints[this.checkpointIndex]);
        ctx.fillStyle = '#1f4b9b';
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    material(a, b, alpha = 1) {
        const mat = new BABYLON.StandardMaterial(`mat-${Math.random()}`, this.scene);
        mat.diffuseColor = BABYLON.Color3.FromHexString(a);
        mat.emissiveColor = BABYLON.Color3.FromHexString(b).scale(0.12);
        mat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
        mat.alpha = alpha;
        return mat;
    }
    makeBush(x, z) {
        const a = BABYLON.MeshBuilder.CreateSphere('bush-a', { diameter: 0.8 }, this.scene);
        const b = BABYLON.MeshBuilder.CreateSphere('bush-b', { diameter: 0.7 }, this.scene);
        a.position.set(x - 0.18, 0.34, z + 0.05);
        b.position.set(x + 0.12, 0.3, z - 0.1);
        const mat = this.material('#73bb66', '#54984a');
        a.material = mat;
        b.material = mat;
    }
    makeFlower(x, z) {
        const stem = BABYLON.MeshBuilder.CreateCylinder('flower-stem', { height: 0.22, diameter: 0.03 }, this.scene);
        stem.position.set(x, 0.12, z);
        stem.material = this.material('#509f4f', '#3d7d3f');
        const petal = BABYLON.MeshBuilder.CreateSphere('flower-petal', { diameter: 0.08 }, this.scene);
        petal.position.set(x, 0.24, z);
        petal.material = this.material('#ffbbd2', '#f58caf');
    }
    makePebble(x, z) {
        const pebble = BABYLON.MeshBuilder.CreateSphere('pebble', { diameter: 0.24 }, this.scene);
        pebble.position.set(x, 0.1, z);
        pebble.scaling = new BABYLON.Vector3(1.4, 0.65, 1.05);
        pebble.material = this.material('#b5bac8', '#8c92a0');
    }
    makeFence(x, z, rotY) {
        const postA = BABYLON.MeshBuilder.CreateBox('fence-post', { width: 0.08, height: 0.36, depth: 0.08 }, this.scene);
        postA.position.set(x - 0.42 * Math.cos(rotY), 0.18, z - 0.42 * Math.sin(rotY));
        const postB = BABYLON.MeshBuilder.CreateBox('fence-post', { width: 0.08, height: 0.36, depth: 0.08 }, this.scene);
        postB.position.set(x + 0.42 * Math.cos(rotY), 0.18, z + 0.42 * Math.sin(rotY));
        const rail1 = BABYLON.MeshBuilder.CreateBox('fence-rail', { width: 0.9, height: 0.06, depth: 0.05 }, this.scene);
        rail1.position.set(x, 0.22, z);
        rail1.rotation.y = rotY;
        const rail2 = BABYLON.MeshBuilder.CreateBox('fence-rail', { width: 0.9, height: 0.06, depth: 0.05 }, this.scene);
        rail2.position.set(x, 0.3, z);
        rail2.rotation.y = rotY;
        const mat = this.material('#a47f5c', '#76583e');
        postA.material = mat;
        postB.material = mat;
        rail1.material = mat;
        rail2.material = mat;
    }
}
new CrossTheValley();
