import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class ClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class MockNode {
  constructor(id = '') {
    this.id = id;
    this.hidden = true;
    this.parentNode = null;
    this.listeners = new Map();
    this.classList = new ClassList();
    this.scrollTop = 0;
    this.scrollHeight = 321;
  }
  cloneNode() {
    const node = new MockNode(this.id);
    node.hidden = this.hidden;
    return node;
  }
  addEventListener(type, listener, options) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push({ listener, options });
    this.listeners.set(type, bucket);
  }
  dispatchEvent(event) {
    event.target = this;
    for (const { listener } of this.listeners.get(event.type) ?? []) listener.call(this, event);
    return true;
  }
}

class MockParent {
  constructor(registry) { this.registry = registry; }
  replaceChild(next, previous) {
    next.parentNode = this;
    previous.parentNode = null;
    this.registry.set(next.id, next);
  }
}

class MockEvent {
  constructor(type) { this.type = type; this.target = null; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() { this.immediatePropagationStopped = true; }
}

const registry = new Map();
const parent = new MockParent(registry);
for (const id of ['story_auto', 'story_skip', 'story_log', 'full-log', 'full-log-body', 'full-log-close']) {
  const node = new MockNode(id);
  node.parentNode = parent;
  registry.set(id, node);
}
registry.get('full-log').hidden = true;

let legacyAutoCalls = 0;
registry.get('story_auto').addEventListener('click', () => { legacyAutoCalls += 1; });

const windowListeners = new Map();
const stage = {
  children: [],
  removeChild(child) {
    this.children = this.children.filter((value) => value !== child);
    child.removed = true;
  },
};

function makeSprite(name) {
  return {
    name,
    internalModel: { coreModel: { setParameterValueById() {} } },
    destroy() { this.destroyed = true; },
  };
}

const homeSprite = makeSprite('homepage-leak');
stage.children.push(homeSprite);
let stopCalls = 0;
let loadCalls = 0;
let scheduleCalls = 0;
let updateButtonCalls = 0;
const player = {
  models: new Map(),
  positions: new Map(),
  state: { characters: new Map() },
  generation: 7,
  auto: false,
  skip: false,
  playing: true,
  busy: false,
  waitingChoice: false,
  timer: 0,
  steps: [{}],
  index: 0,
  stop() { stopCalls += 1; },
  load() { loadCalls += 1; },
  updateState(step) {
    for (const patch of step.chara ?? []) {
      const previous = this.state.characters.get(String(patch.id)) ?? {};
      this.state.characters.set(String(patch.id), { ...previous, ...patch });
    }
  },
  async applyDialogue() {},
  selectDialogue() { return undefined; },
  removeModel(key) {
    const record = this.models.get(String(key));
    if (!record) return;
    this.models.delete(String(key));
    this.state.characters.delete(String(key));
    record.sprite.destroy();
  },
  updateButtons() { updateButtonCalls += 1; },
  schedule() { scheduleCalls += 1; },
};

const windowObject = {
  MagirecoFullStory: { player },
  MagirecoHcaPlayer: {
    isPlaying() { return false; },
    getLevel() { return 0; },
    stopAll() {},
  },
  app: { stage },
  addEventListener(type, listener) { windowListeners.set(type, listener); },
  dispatchEvent() {},
};

Object.assign(globalThis, {
  window: windowObject,
  document: {
    getElementById(id) { return registry.get(id) ?? null; },
  },
  requestAnimationFrame(callback) { return setTimeout(() => callback(performance.now()), 1); },
  cancelAnimationFrame(handle) { clearTimeout(handle); },
  CustomEvent: class CustomEvent extends MockEvent {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  },
});

const source = await readFile('js/full_story_reliability_patch.js', 'utf8');
vm.runInThisContext(source, { filename: 'full_story_reliability_patch.js' });
if (!player.__reliabilityPatchInstalled) throw new Error('reliability patch did not install');
if (updateButtonCalls < 1) throw new Error('control state was not initialized');

player.load({}, 'test');
if (loadCalls !== 1) throw new Error('original player.load was not preserved');
if (!homeSprite.removed || !homeSprite.destroyed || stage.children.includes(homeSprite)) {
  throw new Error('untracked homepage Live2D model was not reclaimed on story load');
}

const keepSprite = makeSprite('keep');
const staleSprite = makeSprite('stale');
player.models.set('100100', { sprite: keepSprite });
player.models.set('100200', { sprite: staleSprite });
player.state.characters.set('100100', { id: 100100, pos: 0 });
player.state.characters.set('100200', { id: 100200, pos: 2 });
player.updateState({ turnChangeIn: 'fadeIn', chara: [{ id: 100100, pos: 0 }] });
if (!player.models.has('100100')) throw new Error('active scene character was incorrectly reclaimed');
if (player.models.has('100200') || !staleSprite.destroyed) {
  throw new Error('stale scene character was not reclaimed');
}

const autoNode = registry.get('story_auto');
autoNode.dispatchEvent(new MockEvent('click'));
if (!player.auto || player.skip) throw new Error('AUTO control did not enable automatic playback');
if (scheduleCalls !== 1) throw new Error('AUTO control did not schedule the current step');
if (legacyAutoCalls !== 0) throw new Error('legacy AUTO handler survived node replacement');

const logNode = registry.get('full-log');
registry.get('story_log').dispatchEvent(new MockEvent('click'));
if (logNode.hidden) throw new Error('LOG control did not open the backlog');
if (registry.get('full-log-body').scrollTop !== 321) throw new Error('LOG did not scroll to the latest entry');
registry.get('full-log-close').dispatchEvent(new MockEvent('click'));
if (!logNode.hidden) throw new Error('LOG close control did not close the backlog');

player.stop(false);
if (stopCalls !== 1) throw new Error('original player.stop was not preserved');
if (typeof windowListeners.get('beforeunload') !== 'function') throw new Error('audio cleanup was not registered');

console.log(JSON.stringify({
  installed: true,
  homepageModelReclaimed: true,
  staleSceneModelReclaimed: true,
  autoControl: true,
  legacyControlConflictRemoved: true,
  logControl: true,
}, null, 2));
