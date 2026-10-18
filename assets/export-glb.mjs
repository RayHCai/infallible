// Writes assets/models/glb/<id>.glb for every pump (metres, Y up).
// Run: node assets/export-glb.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { makeHelpers } from './models/common.js';
import { pumps, buildPump, phone } from './models/index.js';

// GLTFExporter reads blobs through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

// Node has no DOM: back decals and GLTFExporter's image path with a native canvas.
// The exporter mistakes canvases with a `data` member for DataTextures, so hide it.
const newCanvas = () => Object.defineProperty(createCanvas(1, 1), 'data', { value: undefined });
globalThis.HTMLCanvasElement = newCanvas().constructor;
globalThis.document = { createElement: newCanvas };
// system-ui and sans-serif resolve to a condensed face here; alias a real UI font.
const ui = ['Segoe UI', 'Helvetica Neue', 'Helvetica', 'Arial', 'DejaVu Sans', 'Liberation Sans'];
const font = ui.find((f) => GlobalFonts.has(f));
if (font) GlobalFonts.setAlias(font, 'system-ui');

const out = join(dirname(fileURLToPath(import.meta.url)), 'models', 'glb');
await mkdir(out, { recursive: true });
const exporter = new GLTFExporter();
const roots = pumps.map((p) => [p.meta.id, buildPump(THREE, p)]);
roots.push([phone.meta.id, phone.build(makeHelpers(THREE))]);
for (const [id, root] of roots) {
  root.scale.setScalar(0.001);
  root.updateMatrixWorld(true);
  const glb = await exporter.parseAsync(root, { binary: true });
  const file = join(out, `${id}.glb`);
  await writeFile(file, Buffer.from(glb));
  console.log(`${id}.glb  ${(glb.byteLength / 1024).toFixed(0)} KB`);
}
