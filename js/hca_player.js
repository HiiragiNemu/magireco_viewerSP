(function () {
  'use strict';

  const DEFAULT_WASM_URL = './js/hca/hca_wasm_bg.wasm';
  const MAGIA_RECORD_HCA_KEY = 0x01395C51n;
  const RESERVED_HEAP = 132;

  let wasm = null;
  let initPromise = null;
  let cachedUint8 = null;
  let cachedView = null;
  const heap = new Array(128).fill(undefined);
  heap.push(undefined, null, true, false);
  let heapNext = heap.length;

  function addHeapObject(object) {
    if (heapNext === heap.length) heap.push(heap.length + 1);
    const index = heapNext;
    heapNext = heap[index];
    heap[index] = object;
    return index;
  }

  function takeObject(index) {
    const value = heap[index];
    if (index >= RESERVED_HEAP) {
      heap[index] = heapNext;
      heapNext = index;
    }
    return value;
  }

  function memoryBytes() {
    if (!wasm) throw new Error('HCA wasm is not initialized');
    if (!cachedUint8 || cachedUint8.buffer !== wasm.memory.buffer) {
      cachedUint8 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8;
  }

  function memoryView() {
    if (!wasm) throw new Error('HCA wasm is not initialized');
    if (!cachedView || cachedView.buffer !== wasm.memory.buffer) {
      cachedView = new DataView(wasm.memory.buffer);
    }
    return cachedView;
  }

  function wasmString(pointer, length) {
    return new TextDecoder('utf-8', { fatal: false })
      .decode(memoryBytes().subarray(pointer >>> 0, (pointer >>> 0) + length));
  }

  async function instantiateWasm(url) {
    const imports = {
      __wbindgen_placeholder__: {
        __wbindgen_error_new(pointer, length) {
          return addHeapObject(new Error(wasmString(pointer, length)));
        },
      },
    };
    const response = await fetch(url, { cache: 'force-cache', credentials: 'omit' });
    if (!response.ok) throw new Error(`HCA wasm HTTP ${response.status}: ${url}`);
    try {
      return (await WebAssembly.instantiateStreaming(response.clone(), imports)).instance;
    } catch (_) {
      return (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance;
    }
  }

  function initialize(url = DEFAULT_WASM_URL) {
    if (initPromise) return initPromise;
    initPromise = instantiateWasm(url).then((instance) => {
      wasm = instance.exports;
      cachedUint8 = null;
      cachedView = null;
      const required = [
        'memory',
        'decodeHca',
        '__wbindgen_add_to_stack_pointer',
        '__wbindgen_malloc',
        '__wbindgen_free',
      ];
      for (const name of required) {
        if (!wasm[name]) throw new Error(`HCA wasm export is missing: ${name}`);
      }
    }).catch((error) => {
      initPromise = null;
      throw error;
    });
    return initPromise;
  }

  function decodeHca(input, keycode = MAGIA_RECORD_HCA_KEY, subkey = 0) {
    if (!wasm) throw new Error('HCA wasm is not initialized');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const returnPointer = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      const inputPointer = wasm.__wbindgen_malloc(bytes.length, 1) >>> 0;
      memoryBytes().set(bytes, inputPointer);
      wasm.decodeHca(returnPointer, inputPointer, bytes.length, BigInt(keycode), Number(subkey) || 0);

      const view = memoryView();
      const outputPointer = view.getInt32(returnPointer, true);
      const outputLength = view.getInt32(returnPointer + 4, true);
      const errorObject = view.getInt32(returnPointer + 8, true);
      const isError = view.getInt32(returnPointer + 12, true);
      if (isError) throw takeObject(errorObject);
      const output = memoryBytes()
        .subarray(outputPointer >>> 0, (outputPointer >>> 0) + outputLength)
        .slice();
      wasm.__wbindgen_free(outputPointer, outputLength, 1);
      return output;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }

  class BrowserHcaPlayer {
    constructor() {
      this.context = null;
      this.slots = new Map();
      this.cache = new Map();
      this.wasmUrl = DEFAULT_WASM_URL;
    }

    audioContext() {
      if (!this.context || this.context.state === 'closed') {
        const Constructor = window.AudioContext || window.webkitAudioContext;
        if (!Constructor) throw new Error('Web Audio API is unavailable');
        this.context = new Constructor();
      }
      return this.context;
    }

    async load(url, options = {}) {
      const key = `${url}|${options.key || MAGIA_RECORD_HCA_KEY}|${options.subkey || 0}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const promise = (async () => {
        await initialize(options.wasmUrl || this.wasmUrl);
        const response = await fetch(url, { cache: 'force-cache', credentials: 'omit' });
        if (!response.ok) throw new Error(`HCA HTTP ${response.status}: ${url}`);
        const hca = new Uint8Array(await response.arrayBuffer());
        if (hca.length < 4) throw new Error(`HCA file is empty: ${url}`);
        const wav = decodeHca(
          hca,
          options.key ? BigInt(options.key) : MAGIA_RECORD_HCA_KEY,
          Number(options.subkey) || 0,
        );
        const context = this.audioContext();
        const audioBuffer = await context.decodeAudioData(
          wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
        );
        return { audioBuffer, duration: audioBuffer.duration };
      })().catch((error) => {
        this.cache.delete(key);
        throw error;
      });
      this.cache.set(key, promise);
      return promise;
    }

    async play(channel, url, options = {}) {
      const context = this.audioContext();
      await context.resume();
      const decoded = await this.load(url, options);
      this.stop(channel, options.fadeOutMs || 0);

      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = decoded.audioBuffer;
      source.loop = Boolean(options.loop);
      source.connect(gain);
      gain.connect(context.destination);

      const now = context.currentTime;
      const fadeInMs = Math.max(0, Number(options.fadeInMs) || 0);
      gain.gain.setValueAtTime(fadeInMs ? 0 : 1, now);
      if (fadeInMs) gain.gain.linearRampToValueAtTime(1, now + fadeInMs / 1000);
      source.start();

      const slot = { source, gain, context };
      this.slots.set(channel, slot);
      source.addEventListener('ended', () => {
        if (this.slots.get(channel) === slot) this.slots.delete(channel);
        try { source.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
      }, { once: true });

      return { duration: decoded.duration, loop: source.loop };
    }

    stop(channel, fadeMs = 0) {
      const slot = this.slots.get(channel);
      if (!slot) return;
      this.slots.delete(channel);
      const release = () => {
        try { slot.source.stop(); } catch (_) {}
        try { slot.source.disconnect(); } catch (_) {}
        try { slot.gain.disconnect(); } catch (_) {}
      };
      const duration = Math.max(0, Number(fadeMs) || 0);
      if (!duration) return release();
      const now = slot.context.currentTime;
      slot.gain.gain.cancelScheduledValues(now);
      slot.gain.gain.setValueAtTime(slot.gain.gain.value, now);
      slot.gain.gain.linearRampToValueAtTime(0, now + duration / 1000);
      setTimeout(release, duration + 40);
    }

    stopAll() {
      for (const channel of [...this.slots.keys()]) this.stop(channel);
    }

    clearCache() {
      this.cache.clear();
    }
  }

  const player = new BrowserHcaPlayer();
  window.MagirecoHcaPlayer = Object.freeze({
    play: player.play.bind(player),
    stop: player.stop.bind(player),
    stopAll: player.stopAll.bind(player),
    clearCache: player.clearCache.bind(player),
    initialize: () => initialize(player.wasmUrl),
    decodeHca,
    key: MAGIA_RECORD_HCA_KEY,
  });

  console.info('[MAGIRECO HCA] browser bridge registered');
})();
