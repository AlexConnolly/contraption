import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from './sim/rapier.js';

import { Blueprint } from './core/blueprint.js';
import { Input } from './core/input.js';
import { Studio } from './studio/studio.js';
import { starterRover, quadcopter, openingMachine } from './studio/presets.js';
import { crane } from './studio/showpiece.js';
import { Machine } from './sim/machine.js';
import { Arena } from './sim/arena.js';
import { createWorld, gravityOf } from './sim/world.js';
import { SignalBus } from './sim/signals.js';
import { controllerOf, firstController } from './sim/flight.js';
import { getPart, findPart } from './parts/registry.js';
import { loadPacks, usesPacks } from './parts/installed.js';
import {
  ObjectiveTracker, withinMassCap, breachedBy, buildProblem, droppedLoad,
} from './challenges/objectives.js';
import { bannedParts, banFor, firstBanned } from './challenges/bans.js';
import { LEVELS, nextLevel } from './challenges/levels.js';
import { resolveLevel, saveCustomLevel, blankLevel } from './challenges/custom.js';
import { outOfTime, fallLine } from './challenges/format.js';
import { Hud } from './ui/hud.js';
import { GraphEditor } from './ui/graph-editor.js';
import { Builder } from './ui/builder.js';
import { FrontEnd } from './ui/frontend.js';
import { Survey, stopsFor, shotFor, lookFor } from './ui/survey.js';
import { GameAudio } from './ui/audio.js';
import { store } from './ui/progress.js';
import { blueprintGroup, renderMachine } from './ui/thumbnails.js';
import { emptyProgram } from './sim/program.js';
import { WorldSession } from './world/session.js';
import { WorldStore, freeName } from './world/worldstore.js';
import { toWorldCode, fromWorldCode, blankWorld } from './world/format.js';
import { Sandbox, deployAt } from './ui/sandbox.js';
import { NetClient, wsAddress } from './net/client.js';

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
let builder;
let sandbox;
const worlds = new WorldStore();
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

// The open world's garage is the same garage, but its work is not this
// level's work: autosaving it under the current challenge would overwrite
// whatever you had going there.
const GARAGE_SLOT = '__world__';

function designSlot() {
  return state.mode === 'sandbox' ? GARAGE_SLOT : state.level.id;
}

function saveDesign(quiet = false) {
  const ok = store.saveDesign(designSlot(), state.blueprint.toJSON());
  if (quiet) return;
  if (ok) audio.confirm(); else audio.deny();
  hud.toast(ok ? 'Design saved' : 'Could not save — storage blocked', !ok);
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
  const problem = buildProblem(state.blueprint, state.level);
  return problem ? { ok: false, reason: problem } : { ok: true };
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
  // What you were driving a moment ago. The design is already in storage under
  // the level being left, so the copy openingMachine takes is what keeps
  // editing here from reaching back into it.
  const carried = state.blueprint;
  state.level = resolveLevel(id);
  const opening = openingMachine({
    stored: loadDesign(state.level.id),
    carried,
    level: state.level,
  });
  studio.replaceBlueprint(opening.blueprint);
  hud.setLevel(state.level);
  applyBans();
  if (state.mode === 'test') enterTest(); else refreshReadouts();
  if (opening.from === 'carried') {
    hud.toast('Brought your machine with you — save it in the garage to keep it');
  } else if (opening.refused) {
    hud.toast(`Left your machine behind — ${opening.refused.name} here`, true);
  }
}

// --------------------------------------------------------------------- menu

/**
 * The showpiece behind the title, built from meshes alone with no physics and
 * no build markers on it. It is kept well away from the player's own machine:
 * swapping the studio's blueprint for a display model and swapping it back
 * would put somebody's work one failure away from being overwritten.
 */
function showpiece() {
  if (!state.showpiece) {
    state.showpiece = blueprintGroup(crane());
    state.showpiece.visible = false;
    scene.add(state.showpiece);
  }
  return state.showpiece;
}

function openMenu(screen = 'title') {
  if (state.mode === 'test') enterStudio();
  saveDesign(true);
  input.enabled = false;
  hud.setChromeVisible(false);
  // The crane turns behind the title instead of whatever the player last
  // built: a seven-part rover does not answer "how far does this go".
  studio.setVisible(false);
  showpiece().visible = true;
  state.idling = true;
  frontEnd.open(screen);
}

function leaveMenu() {
  frontEnd.close();
  if (state.showpiece) state.showpiece.visible = false;
  state.idling = false;
  input.enabled = !state.level.handsOff || state.mode !== 'test';
  hud.setChromeVisible(true);
  studio.setShowPlate(true);
  enterStudio();
}

/**
 * The level builder. It borrows the same scene and camera the studio uses —
 * you are arranging a course in the world, not in a separate window — so the
 * studio steps aside while it is up.
 */
function openBuilder(level) {
  if (state.mode === 'test') enterStudio();
  saveDesign(true);
  frontEnd.close();
  if (state.showpiece) state.showpiece.visible = false;
  state.idling = false;
  state.mode = 'build';
  disposeRun();
  studio.setVisible(false);
  hud.setChromeVisible(false);
  input.enabled = false;
  controls.enabled = true;
  controls.target.set(0, 1, 0);
  camera.position.set(14, 12, 18);
  builder.open(level);
}

function closeBuilder() {
  builder.close();
  state.mode = 'studio';
  openMenu('build');
}

/**
 * Play the draft without losing it. The level goes in as a normal level, the
 * builder's furniture is put away rather than torn down, and coming back finds
 * the draft exactly as it was.
 */
function tryDraft(level) {
  state.testingDraft = level;
  builder.setChromeVisible(false);
  state.level = level;
  state.mode = 'studio';
  hud.setChromeVisible(true);
  hud.setLevel(level);
  applyBans();
  const stored = loadDesign(level.id);
  studio.replaceBlueprint(stored ?? starterRover());
  input.enabled = true;
  enterStudio();
  hud.toast('Testing your level — Back returns to the builder');
}

function backToBuilder() {
  if (state.mode === 'test') enterStudio();
  disposeRun();
  state.testingDraft = null;
  state.mode = 'build';
  studio.setVisible(false);
  hud.setChromeVisible(false);
  input.enabled = false;
  builder.setChromeVisible(true);
  builder.refresh();
}

// ----------------------------------------------------------------- open world

/**
 * The other game. A world instead of a level, as many machines as you put
 * down instead of one, and nothing to win.
 *
 * It is a session of its own rather than a fourth branch of the campaign's
 * mode switch: `WorldSession` owns its own physics world, its own fleet and
 * its own clock, and everything below is the wiring between that and the
 * screen. The campaign's code path is untouched by any of it.
 */
async function openWorld(doc, id = null) {
  if (state.mode === 'test') enterStudio();
  saveDesign(true);
  frontEnd.close();
  if (state.showpiece) state.showpiece.visible = false;
  state.idling = false;
  disposeRun();
  studio.setVisible(false);

  state.mode = 'sandbox';
  state.worldId = id;
  state.worldCam = null;
  state.session = new WorldSession({ RAPIER, scene, world: doc });
  // The garage in a world keeps its own work, so coming back finds what you
  // were building rather than whatever the last challenge had on the plate.
  const kept = store.design(GARAGE_SLOT);
  if (kept) studio.replaceBlueprint(Blueprint.fromJSON(kept, { bounds: state.blueprint.bounds }));

  sandbox.open();
  setWorldMode('world');
  clearInterval(state.worldAutosave);
  state.worldAutosave = setInterval(() => saveWorld(true), 20000);
}

/**
 * Somebody else's world.
 *
 * A browser cannot listen on a port, so joining means reaching a host process
 * — `npm run host` — which is the authority on everything in there. The
 * session the game gets is built out of what the host sends and behaves like
 * any other; what changes is that nothing this end does to the world happens
 * straight away. Every edit is a request, and the world changes when it comes
 * back.
 */
async function joinWorld(address) {
  const url = wsAddress(address);
  if (!url) {
    hud.toast('That does not look like an address — try localhost:7777', true);
    return;
  }
  if (state.mode === 'test') enterStudio();
  saveDesign(true);
  frontEnd.close();
  if (state.showpiece) state.showpiece.visible = false;
  state.idling = false;
  disposeRun();
  studio.setVisible(false);
  hud.setChromeVisible(false);
  hud.toast(`Reaching ${url}…`);

  const net = new NetClient({
    url,
    name: store.settings({ handle: '' }).handle || 'Player',
    make: (world) => new WorldSession({ RAPIER, scene, world }),
    handlers: {
      onDenied: (why) => {
        audio.deny();
        hud.toast(why, true);
        sandbox.refresh();
      },
      onFleet: (message) => {
        if (message.driving?.player === net.you && message.driving.id) {
          const member = net.session?.fleet.get(message.driving.id);
          if (member) snapCamera(member.machine);
        }
        sandbox.refresh();
      },
      onPlayers: () => sandbox.refresh(),
      onClosed: () => {
        if (state.mode !== 'sandbox') return;
        audio.deny();
        hud.toast('The host closed the connection', true);
        sandbox.refresh();
      },
    },
  });

  let session;
  try {
    session = await net.connect();
  } catch (error) {
    hud.toast(error.message, true);
    openMenu('worlds');
    return;
  }

  state.mode = 'sandbox';
  state.net = net;
  state.session = session;
  state.worldId = null;
  state.worldCam = null;
  const kept = store.design(GARAGE_SLOT);
  if (kept) studio.replaceBlueprint(Blueprint.fromJSON(kept, { bounds: state.blueprint.bounds }));
  sandbox.open();
  setWorldMode('world');
  hud.toast(`Joined ${session.world.name}`);
}

function setWorldMode(mode) {
  const session = state.session;
  if (!session) return;
  // Coming out of world-building, remember where you were stood in it.
  session.hideCursor();
  // Leaving play has to tell the host too, or it goes on driving under keys
  // this end has stopped sending.
  if (mode !== 'play' && state.net && state.net.driving) state.net.askToControl(null);
  if (session.mode === 'world' && mode !== 'world') {
    state.worldCam = { position: camera.position.clone(), target: controls.target.clone() };
  }
  session.setMode(mode);
  const garage = mode === 'garage';

  studio.setVisible(garage);
  session.setVisible(!garage);
  hud.setChromeVisible(garage);
  if (garage) hud.setMode('studio');
  // The keyboard only ever reaches a machine, and only in play.
  input.enabled = mode === 'play';
  controls.enabled = mode !== 'play' || !session.controlled();

  if (garage) {
    controls.target.set(0, 1, 0);
    camera.position.set(7, 6, 9);
  } else if (mode === 'world') {
    if (state.worldCam) {
      camera.position.copy(state.worldCam.position);
      controls.target.copy(state.worldCam.target);
    } else {
      camera.position.set(30, 22, 30);
      controls.target.set(0, 0, 0);
    }
  }
  sandbox.refresh();
}

async function saveWorld(quiet = false) {
  const session = state.session;
  if (!session) return;
  const card = await worlds.save(session.snapshot(), { id: state.worldId });
  if (!card) {
    if (!quiet) {
      audio.deny();
      hud.toast('This browser would not save the world — check its storage settings', true);
    }
    return;
  }
  state.worldId = card.id;
  if (quiet) return;
  audio.confirm();
  hud.toast(`${card.name} saved`);
}

/** The address somebody else would type to join the world you are in. */
async function shareAddress() {
  const url = state.net?.url ?? '';
  try {
    await navigator.clipboard.writeText(url);
    hud.toast('Address copied — anyone on your network can join with it');
  } catch {
    prompt('The address of this world', url);
  }
}

async function shareWorld() {
  const session = state.session;
  if (!session) return;
  const code = await toWorldCode(session.snapshot());
  try {
    await navigator.clipboard.writeText(code);
    hud.toast('World code copied');
  } catch {
    hud.toast('Clipboard refused — the code is in the box', true);
    prompt('Your world code', code);
  }
}

async function leaveWorld(back = 'worlds') {
  clearInterval(state.worldAutosave);
  // While the mode still says sandbox, so the garage's work goes to the
  // garage's slot rather than over whatever this challenge had on the plate.
  saveDesign(true);
  // Somebody else's world is not ours to write down.
  if (!state.net) await saveWorld(true);
  state.net?.dispose();
  state.net = null;
  state.session?.dispose();
  state.session = null;
  sandbox.close();
  state.mode = 'studio';
  studio.setVisible(false);
  hud.setChromeVisible(false);
  // Back to the machine this challenge was left with, not the one the world
  // was being built in.
  const design = loadDesign(state.level.id);
  if (design) studio.replaceBlueprint(design);
  hud.setLevel(state.level);
  applyBans();
  openMenu(back);
}

/** What the mouse does in a world, which depends only on the mode and tool. */
function worldClick(ray) {
  const session = state.session;
  if (!session) return;

  if (session.mode === 'play') {
    const hit = session.pick(ray);
    // Clicking away lets go, which is the other half of clicking to take hold.
    if (state.net) {
      state.net.askToControl(hit ? hit.id : null);
      controls.enabled = !hit;
      if (hit) audio.confirm();
      sandbox.refresh();
      return;
    }
    session.control(hit ? hit.id : null, input);
    controls.enabled = !hit;
    if (hit) {
      snapCamera(hit.machine);
      audio.confirm();
    }
    sandbox.refresh();
    return;
  }
  if (session.mode !== 'world') return;

  if (sandbox.tool === 'deploy') {
    const aim = session.editor.aim(ray);
    if (!aim) return;
    if (state.net) {
      state.net.askToDeploy({
        blueprint: state.blueprint,
        at: deployAt(aim.cell),
        yaw: sandbox.yaw,
        name: state.blueprint.name,
      });
      audio.place();
      return;
    }
    const put = session.deploy({
      blueprint: state.blueprint,
      at: deployAt(aim.cell),
      yaw: sandbox.yaw,
    });
    if (!put.ok) {
      audio.deny();
      hud.toast(put.reason, true);
      return;
    }
    session.select(put.member.id);
    audio.place();
    sandbox.refresh();
    return;
  }

  // Online, a click is a request: the world changes when the host says so.
  if (state.net) {
    const op = session.planEdit(ray, sandbox.tool === 'erase' ? 'erase' : 'place');
    if (op) {
      state.net.askToEdit([op]);
      if (sandbox.tool === 'erase') audio.remove(); else audio.place();
    }
    return;
  }

  const done = sandbox.tool === 'erase' ? session.erase(ray) : session.place(ray);
  if (!done.ok && done.reason) {
    audio.deny();
    hud.toast(done.reason, true);
    return;
  }
  if (done.ok) {
    if (sandbox.tool === 'erase') audio.remove(); else audio.place();
    sandbox.refresh();
  }
}

function worldShortcuts() {
  const session = state.session;
  if (input.wasPressed('Escape')) {
    // Driving? Let go first. Nobody wants one key that both parks the machine
    // and throws away the screen.
    if (session.controlled()) {
      if (state.net) state.net.askToControl(null);
      else session.control(null);
      controls.enabled = true;
      sandbox.refresh();
    } else {
      leaveWorld();
    }
    return;
  }
  if (input.wasPressed('Tab')) {
    const order = ['world', 'garage', 'play'];
    setWorldMode(order[(order.indexOf(session.mode) + 1) % order.length]);
    return;
  }
  if (session.mode === 'garage') {
    if (input.wasPressed('KeyR')) studio.rotateYaw();
    if (input.wasPressed('KeyT')) studio.rotatePitch();
    if (input.wasPressed('KeyX')) studio.deleteHovered();
    if (input.wasPressed('Delete')) studio.deleteSelected();
    if (input.isDown('ControlLeft') || input.isDown('ControlRight')) {
      if (input.wasPressed('KeyZ')) studio.undo();
      if (input.wasPressed('KeyY')) studio.redo();
    }
    return;
  }
  if (session.mode !== 'world') return;
  if (input.wasPressed('Digit1')) sandbox.setTool('place');
  if (input.wasPressed('Digit2')) sandbox.setTool('erase');
  if (input.wasPressed('Digit3')) sandbox.setTool('deploy');
  if (input.wasPressed('KeyR') && sandbox.tool === 'deploy') sandbox.turn();
  if (input.wasPressed('Delete') && session.selected) {
    if (state.net) state.net.askToRemove(session.selected);
    else session.remove(session.selected);
    audio.remove();
    sandbox.refresh();
  }
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
  const box = new THREE.Box3().setFromObject(showpiece());
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z, 3);

  state.idleAngle = (state.idleAngle ?? 0.6) + dt * 0.12;
  // Close enough that it fills its half of the screen. The multiplier was set
  // for a rover, which is a tenth of this thing's reach.
  const radius = reach * 1.45;
  camera.position.set(
    centre.x + Math.sin(state.idleAngle) * radius,
    centre.y + reach * 0.3,
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

function snapCamera(machine = state.machine) {
  if (!machine) return;
  const core = machine.corePosition();
  chaseTarget.copy(core);
  chaseForward.copy(machine.coreForward());
  camera.position.copy(core)
    .addScaledVector(chaseForward, -8)
    .add(new THREE.Vector3(0, 3.6, 0));
  camera.lookAt(core);
  controls.target.copy(core);
}

function updateCamera(dt) {
  const machine = state.mode === 'sandbox'
    ? state.session?.controlled()?.machine ?? null
    : (state.mode === 'test' ? state.machine : null);
  if (!machine) return;
  const core = machine.corePosition();
  chaseTarget.lerp(core, 1 - Math.exp(-dt * 12));
  if (state.cameraMode === 'orbit') {
    controls.target.copy(chaseTarget);
    return;
  }
  chaseForward.lerp(machine.coreForward(), 1 - Math.exp(-dt * 3)).normalize();
  const desired = chaseTarget.clone()
    .addScaledVector(chaseForward, -8)
    .add(new THREE.Vector3(0, 3.6, 0));
  camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
  camera.lookAt(chaseTarget.x, chaseTarget.y + 0.6, chaseTarget.z);
}

// ------------------------------------------------------------------- readouts

function refreshReadouts() {
  hud.setBudget(
    state.blueprint.cost(),
    state.level.budget?.cost,
    state.blueprint.size,
    state.blueprint,
    state.level.massCap,
    state.level.heightCap,
  );
}

function refreshInspector() {
  const selected = studio.selectedId ? state.blueprint.get(studio.selectedId) : null;
  hud.renderInspector(selected, state.blueprint);
}

// ----------------------------------------------------------------- interaction

let pointerDownAt = null;

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  studio.setPointer(x, y);
  builder?.setPointer(x, y);
}

// The studio gets the mouse in the campaign's build mode and in a world's
// garage, which is the same garage.
function onPlate() {
  return state.mode === 'studio'
    || (state.mode === 'sandbox' && state.session?.mode === 'garage');
}

function takesClicks() {
  return onPlate() || state.mode === 'build' || state.mode === 'sandbox';
}

// A ray out of the camera through the pointer, which is what a click on a
// world means: there is no plate to project onto, only whatever is out there.
const caster = new THREE.Raycaster();

function rayThrough(event) {
  const rect = canvas.getBoundingClientRect();
  caster.setFromCamera(new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  ), camera);
  return { origin: caster.ray.origin, dir: caster.ray.direction };
}

canvas.addEventListener('pointermove', (event) => {
  if (state.mode === 'sandbox' && state.session?.mode === 'world') {
    state.session.aimAt(rayThrough(event), sandbox.tool === 'erase' ? 'erase' : 'place');
    return;
  }
  if (!onPlate() && state.mode !== 'build') return;
  setPointerFromEvent(event);
});

canvas.addEventListener('pointerdown', (event) => {
  if (!takesClicks() || event.button !== 0) return;
  pointerDownAt = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener('pointerup', (event) => {
  if (!takesClicks() || event.button !== 0) return;
  if (!pointerDownAt) return;
  const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
  pointerDownAt = null;
  // A drag is the camera being moved, not a click on the course.
  if (moved > 5) return;
  setPointerFromEvent(event);
  if (state.mode === 'sandbox' && state.session?.mode !== 'garage') {
    worldClick(rayThrough(event));
    return;
  }
  if (state.mode === 'build') {
    builder.update();
    builder.click();
    return;
  }
  studio.update();
  const result = studio.click();
  if (result && result.ok === false) {
    audio.deny();
    if (result.reason) hud.toast(result.reason, true);
  }
});

canvas.addEventListener('pointerleave', () => {
  studio?.clearPointer();
  state.session?.hideCursor();
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function handleShortcuts() {
  if (state.mode === 'build') return;
  if (editor?.isOpen || frontEnd?.isOpen || hud?.modalIsOpen) return;
  if (state.mode === 'sandbox') {
    // A world's name is a text box in its own bar; every letter typed in it
    // would otherwise also be a shortcut.
    if (document.activeElement !== sandbox?.name) worldShortcuts();
    return;
  }
  if (survey.isRunning) {
    if (input.wasPressed('Escape') || input.wasPressed('Space')) survey.skip();
    return;
  }
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
  // Worked out once and handed to every objective that wants them, rather
  // than per plate per tick.
  let props = null;
  let machinePoints = null;
  const report = state.tracker.update(STEP, {
    propPosition: (id) => state.arena.propPosition(id),
    corePosition: () => state.machine.corePosition(),
    props: () => (props ??= state.arena.propStates()),
    liveProps: () => state.arena.liveProps(),
    machinePoints: () => (machinePoints ??= state.machine.blueprint.list()
      .map((placed) => state.machine.partWorldPoint(placed))),
  });
  state.arena.showPlates(report.objectives);

  // A course that throws things at you is lost by dropping one, which is the
  // only failure in the game that is not about where the machine went.
  if (!state.won && !state.crashed) {
    const dropped = droppedLoad(state.level, {
      liveProps: () => state.arena.liveProps(),
    });
    if (dropped) {
      state.crashed = true;
      audio.fail();
      hud.showFailure(state.level, report, 'You dropped one');
      return;
    }
  }

  // Some courses have to be flown without touching anything at all.
  if (state.level.noContact && !state.won && !state.crashed && state.machine.contact()) {
    state.crashed = true;
    // Touching something on a no-contact run is an impact; the other two ways
    // to lose a run are not, and they have their own clip.
    audio.crash();
    hud.showFailure(state.level, report, 'You touched something');
    return;
  }
  // Over the edge on a course built over a drop. Nothing was watching for this,
  // so falling off left you sitting at the bottom of the hole with the clock
  // still running and no way back but the menu.
  const floor = fallLine(state.level);
  if (floor !== null && !state.won && !state.crashed
    && state.machine.corePosition().y < floor) {
    state.crashed = true;
    audio.fail();
    hud.showFailure(state.level, report, 'You went over the edge');
    return;
  }
  // Touch anything but the floor and the run is over. Separate from noContact
  // because this one is for machines that drive.
  if (state.level.noBumps && !state.won && !state.crashed
    && state.machine.contact(state.arena.ground)) {
    state.crashed = true;
    audio.crash();
    hud.showFailure(state.level, report, 'You hit something');
    return;
  }
  // A hard clock. Par is a target you can miss; this one ends the run.
  if (!state.won && !state.crashed && outOfTime(state.level, report.elapsed)) {
    state.crashed = true;
    audio.fail();
    hud.showFailure(state.level, report, 'Out of time');
    return;
  }
  // A keep-out covers the airspace above it as well as the ground, which is
  // what stops "put it on tall stilts and reach over" answering everything.
  if (!state.won && !state.crashed) {
    const zone = breachedBy(state.level, state.machine);
    if (zone) {
      state.crashed = true;
      audio.fail();
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
    // A pack writes its own costs and masses, so a run using one is not
    // against the same yardstick as everyone else's and does not go on the
    // board. It still counts as a win on screen.
    const modded = usesPacks(state.blueprint);
    if (!modded) store.recordScore(state.level.id, report.score ?? 0);
    hud.showScore(
      state.level,
      report,
      state.blueprint.cost(),
      state.blueprint,
      nextLevel(state.level.id),
      { modded },
    );
    return;
  }
  if (report.complete && !state.won) {
    state.won = true;
    audio.win();
    const modded = usesPacks(state.blueprint);
    if (!modded) store.recordWin(state.level.id, report.elapsed, state.blueprint.cost());
    hud.showWin(
      state.level,
      report,
      state.blueprint.cost(),
      state.blueprint,
      nextLevel(state.level.id),
      { modded },
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

  if (state.mode === 'sandbox' && state.session) {
    const session = state.session;
    if (session.mode === 'garage') studio.update();
    // The keys go to the host every frame, held or not: "nothing pressed" is
    // as much a fact as "W", and a host that never hears it keeps driving on
    // the last thing it did hear.
    if (state.net) state.net.sendInput(input);
    const steps = session.advance(dt, () => input.endFrame());
    if (steps === 0) input.endFrame();
    session.sync();
    const driving = session.controlled();
    if (driving && session.mode === 'play') audio.update(driving.machine.audioState());
    else audio.silenceMachine();
    // The panel reads positions out of the world, so it is redrawn on a slow
    // beat rather than every frame: sixty rebuilds a second of a list nobody
    // is looking that hard at is a lot of DOM for no gain.
    state.worldPanel = (state.worldPanel ?? 0) + dt;
    if (state.worldPanel > 0.4) {
      state.worldPanel = 0;
      sandbox.refresh();
    }
  } else if (state.mode === 'build') {
    builder.update();
    if (state.arena) {
      // The course runs while you edit it, so a mover or a belt shows what it
      // will actually do rather than sitting still looking harmless.
      state.arena.step(dt);
      world.step();
      state.arena.sync();
    }
    audio.silenceMachine();
    input.endFrame();
  } else if (state.mode === 'studio') {
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
  const lit = state.mode === 'sandbox'
    ? state.session?.controlled()?.machine
    : (state.mode === 'test' ? state.machine : null);
  // Shadows are cast from a box around the sun's target, so in a world the
  // size of a town it has to follow you or half the map is unlit.
  const focus = lit ? lit.corePosition()
    : (state.mode === 'sandbox' ? controls.target : new THREE.Vector3(0, 0, 0));
  sun.position.set(focus.x + 14, focus.y + 22, focus.z + 10);
  sun.target.position.copy(focus);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------------ boot

async function boot() {
  // Before anything reads a saved machine: a machine built with a pack needs
  // the pack's parts in the registry to load at all.
  loadPacks();
  world = createWorld(RAPIER, gravityOf(state.level));

  state.level = resolveLevel(store.lastLevel() ?? 'first-haul');
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
    // Testing a level you are building goes back to the builder, not out to
    // the challenge list — the draft is not saved anywhere yet.
    isTestingDraft: () => Boolean(state.testingDraft),
    onLeaveChallenge: () => (state.testingDraft ? backToBuilder() : openMenu('challenges')),
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
    // Save puts the machine in the garage. It used to save the design for
    // this level, which is already autosaved every half second, so the button
    // duplicated something invisible and did not do the one thing a player
    // pressing Save while building a machine is asking for.
    onSave: () => {
      const name = prompt('Name this machine', state.blueprint.name || 'New machine');
      if (!name) return;
      const saved = store.saveMachine({
        name: name.slice(0, 28),
        blueprint: state.blueprint.toJSON(),
        thumb: renderMachine(state.blueprint),
      });
      if (saved) {
        state.blueprint.name = saved.name;
        audio.confirm();
        hud.toast(`${saved.name} saved to the garage`);
      } else {
        audio.deny();
        hud.toast('No room left to save — clear some machines from the garage', true);
      }
    },
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

  builder = new Builder({
    RAPIER,
    world,
    scene,
    camera,
    handlers: {
      onToast: (message, bad) => hud.toast(message, bad),
      onSave: (level, id) => {
        const saved = saveCustomLevel(level, { id });
        if (!saved) {
          hud.toast('No room left to save that level', true);
          return null;
        }
        return { id: saved.id };
      },
      onTestPlay: (level) => tryDraft(level),
      onDone: () => closeBuilder(),
      onShowCode: (code) => {
        // Clipboard access can be refused, and a code you cannot reach is no
        // use at all — so it goes somewhere it can be selected by hand.
        hud.toast('Clipboard refused — the code is in the box', true);
        prompt('Your level code', code);
      },
    },
  });

  sandbox = new Sandbox({
    handlers: {
      session: () => state.session,
      net: () => state.net,
      onMode: (mode) => setWorldMode(mode),
      onLeave: () => leaveWorld(),
      onSave: () => {
        if (state.net) {
          hud.toast('You are a guest here — the host keeps this world', true);
          return;
        }
        saveWorld();
      },
      onShare: () => (state.net ? shareAddress() : shareWorld()),
      onRename: (name) => {
        if (state.net) {
          hud.toast('Only the host can rename this world', true);
          sandbox.refresh();
          return;
        }
        state.session?.rename(name);
        sandbox.refresh();
      },
      onMaterial: (index) => state.session?.setMaterial(index) ?? 1,
      onArmDeploy: () => {
        // Against no level at all: a world has no budget, no height cap and
        // nothing banned. What is still true is that a machine needs a core
        // and needs to be something rather than nothing.
        const problem = buildProblem(state.blueprint, {});
        if (problem) {
          audio.deny();
          hud.toast(problem, true);
          return;
        }
        setWorldMode('world');
        sandbox.setTool('deploy');
        hud.toast('Click where it should stand — R turns it');
      },
      onSelect: (id) => {
        state.session?.select(id);
        sandbox.refresh();
      },
      onControl: (id) => {
        if (!state.session) return;
        setWorldMode('play');
        if (state.net) {
          state.net.askToControl(id);
          sandbox.refresh();
          return;
        }
        const member = state.session.control(id, input);
        controls.enabled = !member;
        if (member) snapCamera(member.machine);
        sandbox.refresh();
      },
      onFocus: (id) => {
        const member = state.session?.fleet.get(id);
        if (!member) return;
        const at = member.machine.corePosition();
        controls.target.copy(at);
        camera.position.set(at.x + 9, at.y + 7, at.z + 9);
        camera.lookAt(at);
      },
      onEdit: (id) => {
        const member = state.session?.fleet.get(id);
        if (!member) return;
        // A copy, so editing it in the garage does not reshape the one
        // standing in the world under your feet. Deploy puts the new one down.
        studio.replaceBlueprint(Blueprint.fromJSON(
          member.machine.blueprint.toJSON(),
          { bounds: state.blueprint.bounds },
        ));
        setWorldMode('garage');
        hud.toast(`Editing a copy of ${member.name} — Deploy puts the new one down`);
      },
      onDelete: (id) => {
        if (!state.session) return;
        if (state.net) state.net.askToRemove(id);
        else state.session.remove(id);
        audio.remove();
        sandbox.refresh();
      },
    },
  });

  frontEnd = new FrontEnd({
    RAPIER,
    handlers: {
      listWorlds: () => worlds.list(),
      onNewWorld: async () => {
        const doc = blankWorld();
        doc.name = freeName(await worlds.list(), 'New world');
        await openWorld(doc, null);
      },
      onOpenWorld: async (card) => {
        const doc = await worlds.load(card.id);
        if (!doc) {
          hud.toast(`Could not open ${card.name}`, true);
          return;
        }
        await openWorld(doc, card.id);
      },
      onDeleteWorld: async (card) => {
        const sure = await hud.confirm({
          title: `Delete ${card.name}?`,
          body: `${card.blocks} blocks and ${card.vehicles} machines. This cannot be undone.`,
          ok: 'Delete',
        });
        if (!sure) return false;
        return worlds.remove(card.id);
      },
      onJoin: (address) => joinWorld(address),
      // The most likely host is whoever served this page: opening the address
      // your friend sent you and pressing Join should just work.
      suggestHost: () => (location.protocol.startsWith('http') && location.host
        && !location.host.startsWith('localhost:517')
        ? location.host : 'localhost:7777'),
      onWorldCode: async (code) => {
        const result = await fromWorldCode(code);
        if (!result.ok) {
          hud.toast(result.reason, true);
          return;
        }
        await openWorld(result.world, null);
      },
      onPlay: (levelId) => {
        if (levelId !== state.level.id) changeLevel(levelId);
        leaveMenu();
        // A problem you have not solved opens with a look round it; one you
        // have, you already know, so it drops you straight on the plate.
        if (state.level.objectives.length > 0 && !store.solved(levelId)) showCourse();
      },
      onExit: () => { saveDesign(true); location.reload(); },
      onSaveMachine: (name) => {
        const saved = store.saveMachine({
          name,
          blueprint: state.blueprint.toJSON(),
          thumb: renderMachine(state.blueprint),
        });
        if (!saved) hud.toast('No room left to save — clear some machines first', true);
        return Boolean(saved);
      },
      suggestName: () => state.blueprint.name || 'New machine',
      onLoadMachine: (id) => {
        const machine = store.machine(id);
        if (!machine) return;
        const blueprint = Blueprint.fromJSON(machine.blueprint, { bounds: state.blueprint.bounds });
        leaveMenu();
        if (loadMachine(blueprint, machine.name)) hud.toast(`Loaded ${machine.name}`);
      },
      onBuildLevel: (level) => openBuilder(level ?? blankLevel()),
      // A pack installed or removed while the menu is up changes what is in
      // the palette, which is built once and would otherwise not notice until
      // the next reload.
      onPartsChanged: () => {
        // The part in hand, and parts already on the machine, may have gone
        // out with the pack they came from.
        if (!findPart(studio.partType)) studio.setPartType('block');
        const gone = state.blueprint.dropMissing();
        if (gone.length) {
          studio.replaceBlueprint(state.blueprint);
          hud.toast(`${gone.length} parts came off — their pack is gone`, true);
        }
        hud.buildPalette();
        hud.setLevel(state.level);
        hud.setActivePart(studio.partType);
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
      builder,
      frontEnd,
      sandbox,
      worlds,
      openMenu,
      leaveMenu,
      openWorld,
      joinWorld,
      leaveWorld,
      setWorldMode,
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
