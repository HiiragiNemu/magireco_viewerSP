(function () {
  'use strict';

  if (window.MagirecoHcaPlayer) return;

  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL('./hca_audio.js', document.baseURI).href;
  const workerUrl = new URL('./hca_worker.js', scriptUrl).href;
  const wasmUrl = new URL('./hca_wasm_bg.wasm', scriptUrl).href;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const pending = new Map();
  const cache = new Map();
  const slots = new Map();
  let worker = null;
  let context = null;
  let nextId = 1;

  function getContext() {
    if (!AudioContextClass) throw new Error('Web Audio API is unavailable');
    if (!context || context.state === 'closed') context = new AudioContextClass();
    return context;
  }

  function unlock() {
    try {
      const ctx = getContext();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch (error) {
      console.warn('[HCA AUDIO UNLOCK]', error);
    }
  }

  for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(eventName, unlock, { capture: true, passive: true });
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(workerUrl);
    worker.onmessage = (event) => {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (!message.ok) {
        entry.reject(new Error(message.error || 'HCA decode failed'));
        return;
      }
      try {
        const ctx = getContext();
        const frameCount = message.channels[0] ? message.channels[0].length : 1;
        const buffer = ctx.createBuffer(message.channels.length, frameCount, message.sampleRate);
        message.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
        const loop = message.info && message.info.loop
          ? {
              start: message.info.loop.start / message.sampleRate,
              end: message.info.loop.end / message.sampleRate,
            }
          : null;
        entry.resolve({ buffer, info: message.info, loop });
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    worker.onerror = (event) => {
      const error = new Error(`HCA worker crashed: ${event.message || 'unknown error'}`);
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      try { worker.terminate(); } catch (_) {}
      worker = null;
    };
    return worker;
  }

  function normalizeUrl(input) {
    const url = String(input || '');
    return url
      .replace('/fullvoice/fullvoice/', '/fullvoice/')
      .replace(/\/fullvoice\/+(?=section_)/, '/fullvoice/');
  }

  async function decodeUrl(input, keycode) {
    const url = normalizeUrl(input);
    const existing = cache.get(url);
    if (existing) return existing;
    const task = (async () => {
      const response = await fetch(url, {
        cache: 'force-cache',
        credentials: 'omit',
        mode: 'cors',
      });
      if (!response.ok) throw new Error(`HCA fetch failed ${response.status}: ${url}`);
      const bytes = await response.arrayBuffer();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        getWorker().postMessage({
          id,
          bytes,
          keycode: keycode || '0x01395C51',
          subkey: 0,
          wasmUrl,
        }, [bytes]);
      });
    })();
    task.catch(() => cache.delete(url));
    cache.set(url, task);
    return task;
  }

  function stop(channel) {
    const slot = slots.get(channel);
    if (!slot) return;
    slots.delete(channel);
    try { slot.source.onended = null; } catch (_) {}
    try { slot.source.stop(); } catch (_) {}
    try { slot.source.disconnect(); } catch (_) {}
    try { slot.analyser && slot.analyser.disconnect(); } catch (_) {}
    try { slot.gain && slot.gain.disconnect(); } catch (_) {}
  }

  function stopAll() {
    for (const channel of [...slots.keys()]) stop(channel);
  }

  function gainFor(channel) {
    if (channel === 'bgm') return 0.55;
    if (channel === 'se' || channel === 'surround' || channel === 'jingle') return 0.82;
    return 1;
  }

  async function play(channel, input, options) {
    const opts = options || {};
    unlock();
    const ctx = getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const decoded = await decodeUrl(input, opts.key);
    stop(channel);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    gain.gain.value = gainFor(channel);
    source.buffer = decoded.buffer;
    source.loop = Boolean(opts.loop || (decoded.loop && channel === 'bgm'));
    if (source.loop && decoded.loop) {
      source.loopStart = decoded.loop.start;
      source.loopEnd = decoded.loop.end;
    }
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);

    const slot = {
      channel,
      source,
      analyser,
      gain,
      startedAt: ctx.currentTime,
      duration: decoded.buffer.duration,
      samples: new Float32Array(analyser.fftSize),
    };
    slots.set(channel, slot);
    source.onended = () => {
      if (slots.get(channel) !== slot || source.loop) return;
      slots.delete(channel);
      try { source.disconnect(); } catch (_) {}
      try { analyser.disconnect(); } catch (_) {}
      try { gain.disconnect(); } catch (_) {}
    };
    source.start(0);
    return {
      duration: decoded.buffer.duration,
      sampleRate: decoded.buffer.sampleRate,
      channels: decoded.buffer.numberOfChannels,
      loopStart: decoded.loop ? decoded.loop.start : null,
      loopEnd: decoded.loop ? decoded.loop.end : null,
      url: normalizeUrl(input),
    };
  }

  function getLevel(channel) {
    const slot = slots.get(channel);
    if (!slot) return 0;
    slot.analyser.getFloatTimeDomainData(slot.samples);
    let sum = 0;
    for (let index = 0; index < slot.samples.length; index += 1) {
      const value = slot.samples[index];
      sum += value * value;
    }
    return Math.sqrt(sum / slot.samples.length);
  }

  function isPlaying(channel) {
    return slots.has(channel);
  }

  window.MagirecoHcaPlayer = Object.freeze({
    play,
    stop,
    stopAll,
    getLevel,
    isPlaying,
    unlock,
    evict(url) { cache.delete(normalizeUrl(url)); },
    clearCache() { cache.clear(); },
    get state() { return context ? context.state : 'uninitialized'; },
    version: '1.0.0',
  });

  console.info('[HCA AUDIO] browser decoder bridge ready');
})();
