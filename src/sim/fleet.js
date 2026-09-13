import { Machine } from './machine.js';
import { SignalBus } from './signals.js';

/**
 * Every machine in a world at once.
 *
 * The campaign has exactly one machine, and the game is written that way
 * throughout: one blueprint, one bus, one camera, one set of keys. An open
 * world is a fleet — you put down as many as you like, drive one, and the rest
 * carry on running whatever they were told to run.
 *
 * Three things are harmless with one machine and wrong with two, and this is
 * where all three are dealt with.
 *
 * **They pass through each other.** Machine colliders sit in a group that
 * collides with the world and not with itself, which is how the parts of one
 * machine are kept from blowing it apart. With two machines that same rule
 * makes them ghosts. The group is opened up so machines do collide, and a
 * contact filter puts back the only exclusion that was ever wanted: a machine
 * does not collide with itself.
 *
 * **They all answer the same key.** There was one `SignalBus` for the whole
 * app, keyed on bare part ids — and two machines built from one saved design
 * carry the same part ids, so even their toggle states aliased. Each machine
 * gets its own bus and its own input source, and only the one you are driving
 * is given the keyboard.
 *
 * **They never stop costing anything.** Machine bodies are built so they can
 * never sleep, which is right for the single machine in a challenge and
 * ruinous for fifty parked ones. Deployed machines may sleep; Rapier wakes
 * them when anything touches them or the driver takes the controls.
 */

/** A keyboard that never presses anything, for machines nobody is driving. */
const IDLE_KEYS = {
  isDown: () => false,
  wasPressed: () => false,
};

export class Fleet {
  constructor({ RAPIER, world, scene, headless = false }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.headless = headless;
    this.members = new Map();
    this.driving = null;
    this.nextId = 1;

    // Which machine a body belongs to, by body handle. The contact filter is
    // called for every candidate pair involving a machine, so this has to be
    // one map lookup and nothing else.
    this.owner = new Map();

    // Rapier only consults the contact filter on the code path it takes when
    // an event queue is present: `world.step(undefined, hooks)` drops the
    // hooks on the floor without a word. So the fleet owns a queue and owns
    // the step, and nobody has to remember.
    this.events = new RAPIER.EventQueue(true);

    const owner = this.owner;
    const { COMPUTE_IMPULSE } = RAPIER.SolverFlags;
    this.hooks = {
      filterContactPair(c1, c2, b1, b2) {
        const a = owner.get(b1);
        // Anything that is not two parts of the same machine collides as
        // normal. That includes machine against world, which is the common
        // case and wants to be the cheap one.
        if (a === undefined || a !== owner.get(b2)) return COMPUTE_IMPULSE;
        return null;
      },
      filterIntersectionPair() {
        return true;
      },
    };
  }

  /**
   * Puts a machine into the world at a point. Unlike a challenge, where every
   * run starts at the level's one spawn, a deployed machine stays where it was
   * put down.
   */
  deploy({
    blueprint, spawn, yaw = 0, level = null, name = null, owner = null, canSleep = true,
  }) {
    const id = `v${this.nextId}`;
    this.nextId += 1;
    const machine = new Machine({
      RAPIER: this.RAPIER,
      world: this.world,
      scene: this.scene,
      blueprint,
      spawn,
      yaw,
      level,
      canSleep,
      headless: this.headless,
      contacts: this.RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS,
    });
    for (const body of machine.bodies) this.owner.set(body.handle, id);

    const member = {
      id,
      name: name ?? blueprint.name,
      owner,
      yaw,
      machine,
      bus: new SignalBus(IDLE_KEYS),
    };
    this.members.set(id, member);
    return member;
  }

  remove(id) {
    const member = this.members.get(id);
    if (!member) return false;
    for (const body of member.machine.bodies) this.owner.delete(body.handle);
    member.machine.dispose();
    this.members.delete(id);
    if (this.driving === id) this.driving = null;
    return true;
  }

  get(id) {
    return this.members.get(id) ?? null;
  }

  list() {
    return [...this.members.values()];
  }

  /** The machine the keyboard is wired to, or null if nobody is driving. */
  controlled() {
    return this.driving ? this.members.get(this.driving) ?? null : null;
  }

  /**
   * Hands the keyboard to one machine. Whoever had it goes back to reading a
   * keyboard on which nothing is ever pressed, so it coasts rather than
   * carrying on under a key the player is still holding.
   */
  control(id, input) {
    const previous = this.controlled();
    if (previous) previous.bus = new SignalBus(IDLE_KEYS);
    const member = id ? this.members.get(id) : null;
    this.driving = member ? member.id : null;
    if (member) {
      member.bus = new SignalBus(input);
      // Taking the controls has to wake it, or the first key does nothing.
      for (const body of member.machine.bodies) body.wakeUp();
    }
    return member ?? null;
  }

  update(dt) {
    for (const member of this.members.values()) member.machine.update(dt, member.bus);
  }

  /**
   * Advances the world. Always step through here rather than calling
   * `world.step()` directly, or the contact filter is not applied and every
   * machine starts colliding with itself.
   */
  step() {
    this.world.step(this.events, this.hooks);
  }

  syncMeshes() {
    for (const member of this.members.values()) member.machine.syncMeshes();
  }

  dispose() {
    for (const id of [...this.members.keys()]) this.remove(id);
    this.events?.free();
    this.events = null;
  }
}
