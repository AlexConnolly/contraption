import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from './sim/rapier.js';

import { Blueprint } from './core/blueprint.js';
import { Input } from './core/input.js';
import { Studio } from './studio/studio.js';
import { starterRover, quadcopter } from './studio/presets.js';
import { Machine } from './sim/machine.js';
import { Arena } from './sim/arena.js';
import { gravityOf } from './sim/world.js';
import { SignalBus } from './sim/signals.js';
import { controllerOf, firstController } from './sim/flight.js';
import { getPart } from './parts/registry.js';
import {
  ObjectiveTracker, withinBudget, withinMassCap, breachedBy,
} from './challenges/objectives.js';
import { bannedParts, banFor, firstBanned } from './challenges/bans.js';
import { getLevel, LEVELS, nextLevel } from './challenges/levels.js';
import { Hud } from './ui/hud.js';
import { GraphEditor } from './ui/graph-editor.js';
import { FrontEnd } from './ui/frontend.js';
import { Survey, stopsFor, shotFor, lookFor } from './ui/survey.js';
import { GameAudio } from './ui/audio.js';
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
// You can drop the camera under the build plate: parts are allowed on the
// underside of a machine, and you have to be able to see what you are doing.
controls.maxPolarAngle = Math.PI * 0.92;
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
const survey = new Survey({
  onCaption: (caption, step, of) => hud.setSurvey(caption, step, of),
  onEnd: () => endCourse(),
});

const settings = store.settings({
  camera: 'chase',
  shadows: 'on',
  scanlines: 'on',
  volume: 'full',
});

const audio = new GameAudio({ volume: settings.volume });
// Browsers keep audio silent until the person has done something, so the
// first click or keypress anywhere is what actually starts it.
for (const event of ['pointerdown', 'keydown']) {
  addEventListener(event, () => audio.start(), { once: true });
}

/**
 * Every button in the game sounds the same way, wired once here rather than
 * at each of the hundred places a button is built. What it sounds like
 * depends on what kind of control it is, not on which screen it is on.
 */
addEventListener('pointerdown', (event) => {
  const button = event.target.closest?.('button');
  if (!button || button.disabled) return;
  if (button.classList.contains('fe-back') || button.id === 'survey-skip') audio.back();
  else if (button.classList.contains('mode')
    || button.classList.contains('tool')
    || button.closest('.fe-choice')) audio.toggle();
  else audio.click();
}, true);

addEventListener('pointerover', (event) => {
  if (event.target.closest?.('.fe-item, .fe-card, .part-btn')) audio.hover();
}, true);

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
  // The palette will not let you place one, but a machine can arrive from the
  // garage or from a design saved before the level banned it.
  const broken = firstBanned(state.level, state.blueprint);
  if (broken) {
    return { ok: false, reason: `${broken.ban.name}: take the ${broken.part.name} off` };
  }
  return { ok: true };
}

/**
 * What a machine weighs can only be asked once it is built, so unlike the
 * budget this is checked as the run starts rather than while building.
 */
function checkMass() {
  const mass = withinMassCap(state.machine, state.level);
  if (mass.ok) return true;
  state.crashed = true;
  audio.deny();
  hud.showFailure(state.level, state.tracker.report(), mass.reason);
  return false;
}

/**
 * A machine loaded from somewhere else, checked against what this level
 * allows. Refused by name, because "that will not work here" with no reason
 * is the most annoying message a game can give you.
 */
function loadMachine(blueprint, what) {
  const broken = firstBanned(state.level, blueprint);
  if (broken) {
    audio.deny();
    hud.toast(`${what} has a ${broken.part.name} on it — ${broken.ban.name} here`, true);
    return false;
  }
  studio.replaceBlueprint(blueprint);
  return true;
}

// Whatever this level forbids, told to the places that have to refuse it.
function applyBans() {
  hud.applyBans(state.level);
  studio.setBans(
    bannedParts(state.level),
    (partId) => {
      const ban = banFor(state.level, partId);
      return ban ? `${ban.name} on this challenge` : 'Not allowed here';
    },
  );
}

function buildRun() {
  const spawn = new THREE.Vector3(...state.level.spawn);
  // The world outlives any one run, so the level's gravity is set each time
  // rather than baked in when it was created.
  world.gravity = gravityOf(state.level);
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
  checkMass();
}

function enterTest() {
  const check = validateBuild();
  if (!check.ok) {
    audio.deny();
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

// ------------------------------------------------------------- course tour

/**
 * A look round the course before building for it. The arena goes up with no
 * machine in it and the camera visits the start, whatever has to move and
 * where it has to end up. The first question every one of these problems asks
 * is how it could be done at all, and an empty build plate does not answer it.
 */
function buildCourse() {
  disposeRun();
  state.arena = new Arena({ RAPIER, world, scene, level: state.level });
  state.arena.step(0.1);
  state.arena.sync();
  studio.setVisible(false);
}

function showCourse(back = 'studio') {
  if (state.mode === 'test' || survey.isRunning) return;
  state.tourBack = back;
  buildCourse();
  controls.enabled = false;
  hud.setChromeVisible(false);
  survey.start(state.level, camera);
}

function endCourse() {
  hud.hideSurvey();
  if (frontEnd?.isOpen) {
    disposeRun();
    return;
  }
  hud.setChromeVisible(true);
  if (state.tourBack === 'view') enterView();
  else {
    disposeRun();
    enterStudio();
  }
}

/**
 * The course with no machine in it and the camera in your hands. The tour
 * shows you round on rails; this is for going back and looking properly at
 * the bit you are stuck on.
 */
function enterView() {
  saveDesign(true);
  state.mode = 'view';
  buildCourse();
  state.tracker = new ObjectiveTracker(state.level);
  hud.buildObjectives(state.tracker.report());
  hud.renderObjectives(state.tracker.report(), state.level);
  hud.setMode('view');
  hud.hideWin();
  input.enabled = false;
  controls.enabled = true;
  frameCourse();
}

/**
 * Opens on the same shot the tour opens on: standing at the start, looking
 * down the course. A bounding-box overview sounds more useful and is not —
 * on a course with a roof over it, it puts the camera outside the building.
 */
function frameCourse() {
  const stops = stopsFor(state.level);
  if (stops.length === 0) return;
  camera.position.copy(shotFor(stops, 0));
  controls.target.copy(lookFor(stops, 0));
  camera.lookAt(controls.target);
  controls.update();
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
  // One attempt. It costs a flag and it changes what people build, because
  // reliability suddenly beats speed.
  if (state.level.noRespawn) {
    hud.toast('One attempt on this challenge — back to the studio to try again', true);
    return;
  }
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
  applyBans();
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
  if (key === 'volume') audio.setVolume(value);
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
  if (result && result.ok === false) {
    audio.deny();
    if (result.reason) hud.toast(result.reason, true);
  }
});

canvas.addEventListener('pointerleave', () => studio?.clearPointer());
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function handleShortcuts() {
  if (survey.isRunning) {
    if (input.wasPressed('Escape') || input.wasPressed('Space')) survey.skip();
    return;
  }
  if (editor?.isOpen || frontEnd?.isOpen || hud?.modalIsOpen) return;
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
    audio.crash();
    hud.showFailure(state.level, report, 'You touched something');
    return;
  }
  // A keep-out covers the airspace above it as well as the ground, which is
  // what stops "put it on tall stilts and reach over" answering everything.
  if (!state.won && !state.crashed) {
    const zone = breachedBy(state.level, state.machine);
    if (zone) {
      state.crashed = true;
      audio.crash();
      hud.showFailure(state.level, report, 'You went where you should not');
      return;
    }
  }
  // A scored level is never complete — it runs its clock down and then tells
  // you the number.
  if (state.level.scored && !state.won && !state.crashed
    && report.elapsed >= state.level.scored.seconds) {
    state.won = true;
    audio.win();
    store.recordScore(state.level.id, report.score ?? 0);
    hud.showScore(
      state.level,
      report,
      state.blueprint.cost(),
      state.blueprint,
      nextLevel(state.level.id),
    );
    return;
  }
  if (report.complete && !state.won) {
    state.won = true;
    audio.win();
    store.recordWin(state.level.id, report.elapsed, state.blueprint.cost());
    hud.showWin(
      state.level,
      report,
      state.blueprint.cost(),
      state.blueprint,
      nextLevel(state.level.id),
    );
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
    if (!state.idling && !survey.isRunning) studio.update();
    audio.silenceMachine();
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
    audio.update(state.machine.audioState());
    hud.renderObjectives(state.tracker.report(), state.level);
    if (state.machine.corePosition().y < -40) respawn();
  } else {
    // No machine, but the obstacles still move — standing still is what
    // makes a course look easy, and it is the thing you came to look at.
    if (state.arena) {
      state.arena.step(dt);
      world.step();
      state.arena.sync();
    }
    audio.silenceMachine();
    input.endFrame();
  }

  if (survey.isRunning) survey.update(dt, camera);
  else if (state.idling) idleCamera(dt);
  else updateCamera(dt);
  if (controls.enabled && !state.idling && !survey.isRunning) controls.update();
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
    onChange: ({ reason } = {}) => {
      if (reason === 'place' || reason === 'turn') audio.place();
      else if (reason === 'delete') audio.remove();
      else if (reason === 'undo' || reason === 'redo') audio.click();
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
    onModeChange: (mode) => {
      if (mode === 'test') enterTest();
      else if (mode === 'view') enterView();
      else enterStudio();
    },
    onLeaveChallenge: () => openMenu('challenges'),
    onShowCourse: () => showCourse('view'),
    onSkipCourse: () => survey.skip(),
    onNextChallenge: () => {
      const next = nextLevel(state.level.id);
      if (!next) {
        openMenu('challenges');
        return;
      }
      changeLevel(next.id);
      enterStudio();
      showCourse();
    },
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
    onTurnPart: (id, how) => {
      const result = studio.turnPart(id, how);
      if (!result.ok) {
        audio.deny();
        hud.toast(result.reason ?? 'No room to turn it there', true);
      }
    },
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
    // Two to start from, deliberately. The rest of what anybody wants is in
    // their own garage, which the picker lists underneath these.
    presets: () => [
      { id: 'rover', name: 'Rover', blueprint: starterRover() },
      { id: 'drone', name: 'Drone', blueprint: quadcopter() },
    ],
    blueprintOf: (machine) => {
      try {
        return Blueprint.fromJSON(machine.blueprint, { bounds: state.blueprint.bounds });
      } catch {
        return null;
      }
    },
    onPreset: (id) => {
      const presets = { rover: starterRover, drone: quadcopter };
      const make = presets[id];
      if (!make) return;
      if (loadMachine(make(), `The ${id}`)) hud.toast(`Started from the ${id}`);
    },
    onLoadMachine: (id) => {
      const machine = store.machine(id);
      if (!machine) return;
      const blueprint = Blueprint.fromJSON(machine.blueprint, { bounds: state.blueprint.bounds });
      if (loadMachine(blueprint, machine.name)) hud.toast(`Loaded ${machine.name}`);
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
  applyBans();
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
        // A problem you have not solved opens with a look round it; one you
        // have, you already know, so it drops you straight on the plate.
        if (state.level.objectives.length > 0 && !store.solved(levelId)) showCourse();
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
        const blueprint = Blueprint.fromJSON(machine.blueprint, { bounds: state.blueprint.bounds });
        leaveMenu();
        if (loadMachine(blueprint, machine.name)) hud.toast(`Loaded ${machine.name}`);
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
