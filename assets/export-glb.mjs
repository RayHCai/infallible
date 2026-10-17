// Writes assets/models/glb/<id>.glb for every pump (metres, Y up).
// Run: node assets/export-glb.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
