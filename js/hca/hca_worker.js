'use strict';

let wasm = null;
let wasmPromise = null;
let cachedU8 = null;
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
  if (index >= 132) {
    heap[index] = heapNext;
    heapNext = index;
  }
  return value;
}

function memoryU8() {
  if (!wasm) throw new Error('HCA wasm is not initialized');
  if (!cachedU8 || cachedU8.buffer !== wasm.memory.buffer) {
    cachedU8 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedU8;
}

function memoryView() {
  if (!wasm) throw new Error('HCA wasm is not initialized');
  if (!cachedView || cachedView.buffer !== wasm.memory.buffer) {
    cachedView = new DataView(wasm.memory.buffer);
  }
  return cachedView;
}

async function initializeWasm(url) {
  if (wasmPromise) return wasmPromise;
  wasmPromise = (async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const imports = {
      __wbindgen_placeholder__: {
        __wbindgen_error_new(pointer, length) {
          const bytes = memoryU8().subarray(pointer >>> 0, (pointer >>> 0) + length);
          return addHeapObject(new Error(decoder.decode(bytes)));
        },
      },
    };
    let result;
    try {
      result = await WebAssembly.instantiateStreaming(fetch(url, { cache: 'force-cache' }), imports);
    } catch (_) {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HCA wasm fetch failed ${response.status}`);
      result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
    }
    wasm = result.instance.exports;
    cachedU8 = null;
    cachedView = null;
  })();
  return wasmPromise;
}

function decodeHca(input, keycode, subkey) {
  if (!wasm) throw new Error('HCA wasm is not initialized');
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const pointer = wasm.__wbindgen_malloc(input.length, 1) >>> 0;
    memoryU8().set(input, pointer);
    wasm.decodeHca(retptr, pointer, input.length, BigInt(keycode), subkey);
    const view = memoryView();
    const outputPointer = view.getInt32(retptr, true);
    const outputLength = view.getInt32(retptr + 4, true);
    const errorObject = view.getInt32(retptr + 8, true);
    const isError = view.getInt32(retptr + 12, true);
    if (isError) throw takeObject(errorObject);
    const output = memoryU8().subarray(outputPointer >>> 0, (outputPointer >>> 0) + outputLength).slice();
    wasm.__wbindgen_free(outputPointer, outputLength, 1);
    return output;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

function signatureAt(view, offset) {
  let value = '';
  for (let index = 0; index < 4; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index) & 0x7f);
  }
  return value;
}

function parseHcaHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || signatureAt(view, 0) !== 'HCA\0') throw new Error('Not an HCA file');
  const dataOffset = view.getUint16(6, false);
  let channelCount = 0;
  let sampleRate = 0;
  let blockCount = 0;
  let encoderDelay = 0;
  let encoderPadding = 0;
  let cipherType = 0;
  let loopStartBlock = -1;
  let loopEndBlock = -1;
  let loopStartDelay = 0;
  let loopEndPadding = 0;
  let offset = 8;
  const limit = Math.min(dataOffset, bytes.byteLength);
  while (offset + 4 <= limit) {
    const signature = signatureAt(view, offset);
    if (signature.startsWith('pad')) break;
    if (signature === 'fmt\0') {
      channelCount = view.getUint8(offset + 4);
      sampleRate = (view.getUint8(offset + 5) << 16) |
        (view.getUint8(offset + 6) << 8) |
        view.getUint8(offset + 7);
      blockCount = view.getUint32(offset + 8, false);
      encoderDelay = view.getUint16(offset + 12, false);
      encoderPadding = view.getUint16(offset + 14, false);
      offset += 16;
    } else if (signature === 'comp') offset += 16;
    else if (signature === 'dec\0') offset += 12;
    else if (signature === 'vbr\0') offset += 8;
    else if (signature === 'ath\0') offset += 6;
    else if (signature === 'loop') {
      loopStartBlock = view.getUint32(offset + 4, false);
      loopEndBlock = view.getUint32(offset + 8, false);
      loopStartDelay = view.getUint16(offset + 12, false);
      loopEndPadding = view.getUint16(offset + 14, false);
      offset += 16;
    } else if (signature === 'ciph') {
      cipherType = view.getUint16(offset + 4, false);
      offset += 6;
    } else if (signature === 'rva\0') offset += 8;
    else if (signature === 'comm') offset += 5 + view.getUint8(offset + 4);
    else break;
  }
  if (!channelCount || !sampleRate) throw new Error('HCA header missing fmt chunk');
  const totalSamples = blockCount * 1024 - encoderDelay - encoderPadding;
  let loop = null;
  if (loopStartBlock >= 0 && loopEndBlock >= loopStartBlock) {
    const start = loopStartBlock * 1024 + loopStartDelay - encoderDelay;
    const end = loopEndBlock * 1024 + (1024 - loopEndPadding) - encoderDelay;
    const clampedStart = Math.max(0, Math.min(start, totalSamples));
    const clampedEnd = Math.max(clampedStart, Math.min(end, totalSamples));
    if (clampedEnd > clampedStart) loop = { start: clampedStart, end: clampedEnd };
  }
  return { channelCount, sampleRate, blockCount, encoderDelay, encoderPadding, cipherType, totalSamples, loop };
}

function readWav(wav) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset) => String.fromCharCode(wav[offset], wav[offset + 1], wav[offset + 2], wav[offset + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('HCA decoder did not return WAV');
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (bitsPerSample !== 16) throw new Error(`Unexpected HCA PCM depth ${bitsPerSample}`);
      const byteLength = Math.min(size, wav.byteLength - body);
      const copy = wav.slice(body, body + byteLength);
      return { channelCount, sampleRate, pcm: new Int16Array(copy.buffer) };
    }
    offset = body + size + (size & 1);
  }
  throw new Error('WAV data chunk not found');
}

function deinterleave(pcm, channelCount) {
  const frames = Math.floor(pcm.length / channelCount);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let frame = 0, pointer = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      channels[channel][frame] = pcm[pointer++] / 32768;
    }
  }
  return channels;
}

self.onmessage = async (event) => {
  const { id, bytes, keycode, subkey, wasmUrl } = event.data;
  try {
    await initializeWasm(wasmUrl);
    const raw = new Uint8Array(bytes);
    const info = parseHcaHeader(raw);
    const wav = decodeHca(raw, keycode || '0x01395C51', Number(subkey) || 0);
    const decoded = readWav(wav);
    const channels = deinterleave(decoded.pcm, decoded.channelCount || info.channelCount);
    self.postMessage({
      id,
      ok: true,
      channels,
      sampleRate: decoded.sampleRate || info.sampleRate,
      info,
    }, channels.map((channel) => channel.buffer));
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
