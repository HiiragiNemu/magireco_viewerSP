import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [wasmArgument, hcaArgument, keyArgument = '0x01395C51'] = process.argv.slice(2);
if (!wasmArgument || !hcaArgument) {
  console.error('Usage: node tools/verify_hca_decoder.mjs <decoder.wasm> <sample.hca> [keycode]');
  process.exit(2);
}

const wasmBytes = await readFile(resolve(wasmArgument));
const hcaBytes = new Uint8Array(await readFile(resolve(hcaArgument)));
if (Buffer.from(wasmBytes.subarray(0, 4)).compare(Buffer.from([0x00, 0x61, 0x73, 0x6d])) !== 0) {
  throw new Error('decoder file is not WebAssembly');
}
if (hcaBytes.length < 8 || String.fromCharCode(...hcaBytes.subarray(0, 4).map((value) => value & 0x7f)) !== 'HCA\0') {
  throw new Error('sample file is not HCA');
}

let wasm;
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
  return new Uint8Array(wasm.memory.buffer);
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const instance = await WebAssembly.instantiate(wasmBytes, {
  __wbindgen_placeholder__: {
    __wbindgen_error_new(pointer, length) {
      const bytes = memoryU8().subarray(pointer >>> 0, (pointer >>> 0) + length);
      return addHeapObject(new Error(decoder.decode(bytes)));
    },
  },
});
wasm = instance.instance.exports;

function decodeHca(input, keycode, subkey = 0) {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const pointer = wasm.__wbindgen_malloc(input.length, 1) >>> 0;
    memoryU8().set(input, pointer);
    wasm.decodeHca(retptr, pointer, input.length, BigInt(keycode), subkey);
    const view = new DataView(wasm.memory.buffer);
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

const wav = decodeHca(hcaBytes, keyArgument, 0);
const header = Buffer.from(wav.subarray(0, 12)).toString('ascii');
if (!header.startsWith('RIFF') || header.slice(8, 12) !== 'WAVE') {
  throw new Error(`decoder output is not RIFF/WAVE: ${JSON.stringify(header)}`);
}
if (wav.length <= 44) throw new Error(`decoded WAV is unexpectedly small: ${wav.length}`);

console.log(JSON.stringify({
  wasmBytes: wasmBytes.length,
  hcaBytes: hcaBytes.length,
  wavBytes: wav.length,
  keycode: keyArgument,
  riffWave: true,
}, null, 2));
