// Loads the page's own copy of ExcelJS (docs/vendor/exceljs.min.js) in Node,
// so tests and scripts use exactly what the browser uses, with nothing to install.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

export const loadExcelJS = () => {
  const source = readFileSync(new URL('../docs/vendor/exceljs.min.js', import.meta.url), 'utf8');
  // Binary types are shared with the sandbox so Node's bytes pass ExcelJS's type checks.
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setImmediate,
    TextEncoder,
    TextDecoder,
    Buffer,
    process,
    ArrayBuffer,
    DataView,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  createContext(sandbox);
  runInContext(source, sandbox);
  return sandbox.ExcelJS;
};
