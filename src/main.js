import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from './sim/rapier.js';

import { Blueprint } from './core/blueprint.js';
import { Input } from './core/input.js';
import { Studio } from './studio/studio.js';
import { starterRover, quadcopter, autoDrone } from './studio/presets.js';
import { dodger } from './studio/dodger.js';
import { Machine } from './sim/machine.js';
import { Arena } from './sim/arena.js';
import { SignalBus } from './sim/signals.js';
import { controllerOf, firstController } from './sim/flight.js';
import { getPart } from './parts/registry.js';
import { ObjectiveTracker, withinBudget } from './challenges/objectives.js';
import { getLevel, LEVELS } from './challenges/levels.js';
import { Hud } from './ui/hud.js';
import { GraphEditor } from './ui/graph-editor.js';
import { FrontEnd } from './ui/frontend.js';
import { store } from './ui/progress.js';
import { renderMachine } from './ui/thumbnails.js';
import { emptyProgram } from './sim/program.js';

const STEP = 1 / 60;

const state = {
  mode: 'studio',
  level: LEVELS[1],
  blueprint: new Blueprint(),
  machine: null,
  arena: null,
  tracker: null,
  cameraMode: 'chase',
  won: false,
  crashed: false,
  idling: false,
};

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151a20);
scene.fog = new THREE.Fog(0x151a20, 32, 88);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
camera.position.set(7, 6, 9);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.495;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x2a2f37, 1.05));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.1);
sun.position.set(14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0012;
scene.add(sun);
scene.add(sun.target);

const input = new Input();
const bus = new SignalBus(input);

let studio;
let hud;
let world;
let editor;
let frontEnd;

const settings = store.settings({
  camera: 'chase',
  shadows: 'on',
  scanlines: 'on',
});

// ---------------------------------------------------------------- persistence

function saveDesign(quiet = false) {
  const ok = store.saveDesign(state.level.id, state.blueprint.toJSON());
  if (!quiet) hud.toast(ok ? 'Design saved' : 'Could not save — storage blocked', !ok);
}

function loadDesign(levelId) {
  const data = store.design(levelId);
  return data ? Blueprint.fromJSON(data, { bounds: state.blueprint.bounds }) : null;
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveDesign(true), 500);
}

// ---------------------------------------------------------------------- modes

function disposeRun() {
  state.machine?.dispose();
  state.arena?.dispose();
  state.machine = null;
  state.arena = null;
}

function validateBuild() {
  if (state.blueprint.size === 0) {
    return { ok: false, reason: 'Nothing built yet. Place a Control Core to start.' };
  }
  if (!state.blueprint.list().some((p) => p.type === 'core')) {
    return { ok: false, reason: 'Add a Control Core — the machine needs one.' };
  }
  const budget = withinBudget(state.blueprint, state.level);
  if (!budget.ok) return { ok: false, reason: budget.reason };
  return { ok: true };
}

function buildRun() {
  const spawn = new THREE.Vector3(...state.level.spawn);
  state.arena = new Arena({ RAPIER, world, scene, level: state.level });
  state.machine = new Machine({
    RAPIER, world, scene, blueprint: state.blueprint, spawn, level: state.level,
  });
  state.tracker = new ObjectiveTracker(state.level);
  hud.buildObjectives(state.tracker.report());
  bus.reset();
  state.won = false;
  state.crashed = false;
  hud.hideWin();
  snapCamera();
}

function enterTest() {
  const check = validateBuild();
  if (!check.ok) {
    hud.toast(check.reason, true);
    return;
  }
  const orphans = studio.grouping?.disconnected ?? [];
  const seized = studio.grouping?.seized ?? [];
  if (orphans.length > 0) {
    hud.toast(`${orphans.length} part(s) are not attached — they will fall off`, true);
  } else if (seized.length > 0) {
    hud.toast(`${seized.length} joint(s) are bridged by the build and cannot move`, true);
  }
  saveDesign(true);
  state.mode = 'test';
  studio.setVisible(false);
  disposeRun();
  buildRun();
  input.enabled = !state.level.handsOff;
  const controller = firstController(state.blueprint);
  hud.setMode('test', controller
    ? { ...getPart('controller').flight.defaultKeys, ...(controller.config.keys ?? {}) }
    : null);
  controls.enabled = state.cameraMode === 'orbit';
}

function enterStudio() {
  state.mode = 'studio';
  input.enabled = true;
  disposeRun();
  studio.setVisible(true);
  hud.setMode('studio');
  hud.hideWin();
  controls.enabled = true;
  controls.target.set(0, 1, 0);
  camera.position.set(7, 6, 9);
  refreshReadouts();
}

function respawn() {
  if (state.mode !== 'test') return;
  state.machine?.dispose();
  state.arena.reset();
  const spawn = new THREE.Vector3(...state.level.spawn);
  state.machine = new Machine({
    RAPIER, world, scene, blueprint: state.blueprint, spawn, level: state.level,
  });
  state.tracker.reset();
  bus.reset();
  state.won = false;
  state.crashed = false;
  hud.hideWin();
  snapCamera();
}

function changeLevel(id) {
  saveDesign(true);
  state.level = getLevel(id);
  const stored = loadDesign(state.level.id);
  studio.replaceBlueprint(stored ?? starterRover());
  hud.setLevel(state.level);
  if (state.mode === 'test') enterTest(); else refreshReadouts();
}

// --------------------------------------------------------------------- menu

function openMenu(screen = 'title') {
  if (state.mode === 'test') enterStudio();
  saveDesign(true);
  input.enabled = false;
  hud.setChromeVisible(false);
  // The title screen has the workshop turning slowly behind it.
  studio.setVisible(true);
  studio.setShowPlate(false);
  state.idling = true;
  frontEnd.open(screen);
}

function leaveMenu() {
  frontEnd.close();
  state.idling = false;
  input.enabled = !state.level.handsOff || state.mode !== 'test';
  hud.setChromeVisible(true);
  studio.setShowPlate(true);
  enterStudio();
}

function applySetting(key, value) {
  settings[key] = value;
  store.setSetting(key, value);
  if (key === 'camera') state.cameraMode = value;
  if (key === 'shadows') renderer.shadowMap.enabled = value === 'on';
  if (key === 'scanlines') frontEnd.setScanlines(value === 'on');
  if (key === 'shadows') scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
}

// A slow orbit of whatever is on the build plate, behind the title screen. The
// machine is pushed into the right of the frame so the menu down the left side
// never sits on top of it.
const idleLook = new THREE.Vector3();
const idleRight = new THREE.Vector3();

function idleCamera(dt) {
  const { centre, reach } = studio.machineFraming();

  state.idleAngle = (state.idleAngle ?? 0.6) + dt * 0.12;
  const radius = reach * 2.8;
  camera.position.set(
    centre.x + Math.sin(state.idleAngle) * radius,
    centre.y + reach * 1.25,
    centre.z + Math.cos(state.idleAngle) * radius,
  );
  camera.lookAt(centre);

  // Pan the aim to the left of the machine, which slides the machine itself
  // into the right of the picture.
  idleRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  idleLook.copy(centre).addScaledVector(idleRight, -reach * 0.75);
  camera.lookAt(idleLook);
}

// --------------------------------------------------------------------- camera

const chaseTarget = new THREE.Vector3();
const chaseForward = new THREE.Vector3(0, 0, 1);

function snapCamera() {
  if (!state.machine) return;
  const core = state.machine.corePosition();
  chaseTarget.copy(core);
  chaseForward.copy(state.machine.coreForward());
  camera.position.copy(core)
    .addScaledVector(chaseForward, -8)
    .add(new THREE.Vector3(0, 3.6, 0));
  camera.lookAt(core);
  controls.target.copy(core);
}

function updateCamera(dt) {
  if (state.mode !== 'test' || !state.machine) return;
  const core = state.machine.corePosition();
  chaseTarget.lerp(core, 1 - Math.exp(-dt * 12));
  if (state.cameraMode === 'orbit') {
    controls.target.copy(chaseTarget);
    return;
  }
  chaseForward.lerp(state.machine.coreForward(), 1 - Math.exp(-dt * 3)).normalize();
  const desired = chaseTarget.clone()
    .addScaledVector(chaseForward, -8)
    .add(new THREE.Vector3(0, 3.6, 0));
  camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
  camera.lookAt(chaseTarget.x, chaseTarget.y + 0.6, chaseTarget.z);
}

// ------------------------------------------------------------------- readouts

function refreshReadouts() {
  hud.setBudget(state.blueprint.cost(), state.level.budget?.cost, state.blueprint.size);
}

function refreshInspector() {
  const selected = studio.selectedId ? state.blueprint.get(studio.selectedId) : null;
  hud.renderInspector(selected, state.blueprint);
}

// ----------------------------------------------------------------- interaction

let pointerDownAt = null;

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  studio.setPointer(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

canvas.addEventListener('pointermove', (event) => {
  if (state.mode !== 'studio') return;
  setPointerFromEvent(event);
});

canvas.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'studio' || event.button !== 0) return;
  pointerDownAt = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener('pointerup', (event) => {
  if (state.mode !== 'studio' || event.button !== 0 || !pointerDownAt) return;
  const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
  pointerDownAt = null;
  if (moved > 5) return;
  setPointerFromEvent(event);
  studio.update();
  const result = studio.click();
  if (result && result.ok === false && result.reason) hud.toast(result.reason, true);
});

canvas.addEventListener('pointerleave', () => studio?.clearPointer());
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function handleShortcuts() {
  if (editor?.isOpen || frontEnd?.isOpen) return;
  // Escape drops out of the game and back to the menu.
  if (input.wasPressed('Escape')) {
    openMenu();
    return;
  }
  if (input.wasPressed('Tab')) {
    if (state.mode === 'studio') enterTest(); else enterStudio();
  }
  if (state.mode === 'test') {
    if (input.wasPressed('KeyK')) respawn();
    if (input.wasPressed('KeyC')) {
      applySetting('camera', state.cameraMode === 'chase' ? 'orbit' : 'chase');
      controls.enabled = state.cameraMode === 'orbit';
      hud.toast(`Camera: ${state.cameraMode}`);
    }
    return;
  }

  if (input.wasPressed('KeyR')) studio.rotateYaw();
  if (input.wasPressed('KeyT')) studio.rotatePitch();
  if (input.wasPressed('Digit1')) selectTool('place');
  if (input.wasPressed('Digit2')) selectTool('select');
  if (input.wasPressed('Digit3')) selectTool('delete');
  if (input.wasPressed('KeyX')) studio.deleteHovered();
  if (input.wasPressed('Delete')) studio.deleteSelected();
  if (input.isDown('ControlLeft') || input.isDown('ControlRight')) {
    if (input.wasPressed('KeyZ') && !studio.undo()) hud.toast('Nothing to undo');
    if (input.wasPressed('KeyY') && !studio.redo()) hud.toast('Nothing to redo');
  }
}

function selectTool(tool) {
  studio.setTool(tool);
  hud.setActiveTool(tool);
  if (tool !== 'select') {
    studio.selectedId = null;
    refreshInspector();
  }
}

// ------------------------------------------------------------------- main loop

function simulateStep() {
  // Movers first, so the sensors read where the obstacles actually are.
  state.arena.step(STEP);
  state.machine.update(STEP, bus);
  world.step();
  const report = state.tracker.update(STEP, {
    propPosition: (id) => state.arena.propPosition(id),
    corePosition: () => state.machine.corePosition(),
  });

  // Some courses have to be flown without touching anything at all.
  if (state.level.noContact && !state.won && !state.crashed && state.machine.contact()) {
    state.crashed = true;
    hud.showFailure(state.level, report, 'You touched something');
    return;
  }
  if (report.complete && !state.won) {
    state.won = true;
    store.recordWin(state.level.id, report.elapsed, state.blueprint.cost());
    hud.showWin(state.level, report, state.blueprint.cost());
  }
}

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

let last = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  handleShortcuts();

  if (state.mode === 'studio') {
    if (!state.idling) studio.update();
    input.endFrame();
  } else if (state.machine) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      simulateStep();
      accumulator -= STEP;
      steps += 1;
      // Key presses must only be seen by the first substep, or a toggle
      // bound to one keystroke would flip several times.
      if (steps === 1) input.endFrame();
    }
    if (steps === 0) input.endFrame();
    state.machine.syncMeshes();
    state.arena.sync();
    hud.renderObjectives(state.tracker.report(), state.level);
    if (state.machine.corePosition().y < -40) respawn();
  } else {
    input.endFrame();
  }

  if (state.idling) idleCamera(dt);
  else updateCamera(dt);
  if (controls.enabled && !state.idling) controls.update();
  const focus = state.mode === 'test' && state.machine
    ? state.machine.corePosition()
    : new THREE.Vector3(0, 0, 0);
  sun.position.set(focus.x + 14, focus.y + 22, focus.z + 10);
  sun.target.position.copy(focus);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------------ boot

async function boot() {
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  state.level = getLevel(store.lastLevel() ?? 'first-haul');
  const stored = loadDesign(state.level.id);
  state.blueprint = stored ?? starterRover();

  studio = new Studio({
    scene,
    camera,
    blueprint: state.blueprint,
    onChange: () => {
      refreshReadouts();
      refreshInspector();
      scheduleAutosave();
    },
  });

  hud = new Hud({
    onSelectPart: (id) => {
      studio.setPartType(id);
      hud.setActivePart(id);
      selectTool('place');
    },
    onSelectTool: selectTool,
    onModeChange: (mode) => (mode === 'test' ? enterTest() : enterStudio()),
    onLevelChange: changeLevel,
    onSave: () => saveDesign(),
    onLoad: () => {
      const design = loadDesign(state.level.id);
      if (!design) {
        hud.toast('No saved design for this challenge', true);
        return;
      }
      studio.replaceBlueprint(design);
      hud.toast('Design loaded');
    },
    onClear: () => {
      studio.clear();
      hud.toast('Cleared — Ctrl+Z to undo');
    },
    onRespawn: respawn,
    onBindingChange: (id, binding) => {
      state.blueprint.setConfig(id, { binding });
      refreshInspector();
    },
    onConfigChange: (id, config) => state.blueprint.setConfig(id, config),
    onDeleteSelected: () => studio.deleteSelected(),
    onOpenProgram: (computerId) => {
      const placed = state.blueprint.get(computerId);
      if (!placed) return;
      editor.open({
        program: placed.config.program ?? emptyProgram(),
        blueprint: state.blueprint,
        level: state.level,
        name: `${state.level.name} — program`,
      });
    },
    onLinkThrusters: (controllerId) => {
      let linked = 0;
      for (const placed of state.blueprint.list()) {
        if (!getPart(placed.type).thruster) continue;
        if (controllerOf(state.blueprint, placed) === controllerId) continue;
        state.blueprint.setConfig(placed.id, {
          binding: { mode: 'flight', source: controllerId },
        });
        linked += 1;
      }
      refreshInspector();
      scheduleAutosave();
      hud.toast(`Linked ${linked} thruster${linked === 1 ? '' : 's'} to the controller`);
    },
    onReselect: refreshInspector,
    onPreset: (id) => {
      const presets = {
        rover: starterRover, quadcopter, auto: autoDrone, dodger, empty: () => new Blueprint(),
      };
      studio.replaceBlueprint(presets[id]());
      hud.toast(`Loaded the ${id} to start from`);
    },
    onCaptureKey: (handler) => input.capture((code) => {
      handler(code);
      refreshInspector();
    }),
  });

  editor = new GraphEditor({
    onChange: (program) => {
      const computer = state.blueprint.list().find((p) => getPart(p.type).computer);
      if (computer) state.blueprint.setConfig(computer.id, { program });
      scheduleAutosave();
    },
    onClose: () => refreshInspector(),
  });

  hud.setLevel(state.level);
  hud.setMode('studio');
  hud.setActivePart(studio.partType);
  hud.setActiveTool('place');
  refreshReadouts();
  refreshInspector();
  hud.ready();

  frontEnd = new FrontEnd({
    RAPIER,
    handlers: {
      onPlay: (levelId) => {
        if (levelId !== state.level.id) changeLevel(levelId);
        leaveMenu();
      },
      onExit: () => { saveDesign(true); location.reload(); },
      onSaveMachine: (name) => {
        store.saveMachine({
          name,
          blueprint: state.blueprint.toJSON(),
          thumb: renderMachine(state.blueprint),
        });
      },
      suggestName: () => state.blueprint.name || 'New machine',
      onLoadMachine: (id) => {
        const machine = store.machine(id);
        if (!machine) return;
        studio.replaceBlueprint(
          Blueprint.fromJSON(machine.blueprint, { bounds: state.blueprint.bounds }),
        );
        leaveMenu();
        hud.toast(`Loaded ${machine.name}`);
      },
      getSettings: () => ({ ...settings }),
      onSetting: applySetting,
    },
  });

  if (import.meta.env.DEV) {
    window.__contraption = {
      state,
      studio,
      hud,
      input,
      bus,
      editor,
      frontEnd,
      openMenu,
      leaveMenu,
      // One pass of the keyboard shortcuts, for checks that cannot rely on the
      // frame loop running.
      shortcuts() {
        handleShortcuts();
        input.endFrame();
      },
      // Steps and redraws on demand. A browser tab in the background stops
      // calling requestAnimationFrame, so automated checks drive it from here.
      advance(seconds) {
        const steps = Math.round(seconds / STEP);
        for (let i = 0; i < steps; i += 1) {
          if (state.machine) simulateStep();
          updateCamera(STEP);
        }
        state.machine?.syncMeshes();
        state.arena?.sync();
        if (state.tracker) hud.renderObjectives(state.tracker.report(), state.level);
        renderer.render(scene, camera);
      },
      draw() {
        studio.update();
        renderer.render(scene, camera);
      },
    };
  }

  addEventListener('resize', resize);
  addEventListener('beforeunload', () => saveDesign(true));
  resize();
  for (const [key, value] of Object.entries(settings)) applySetting(key, value);
  openMenu('title');
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  document.getElementById('loading').textContent = `Failed to start: ${error.message}`;
  throw error;
});
