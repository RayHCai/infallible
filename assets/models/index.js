import { makeHelpers, bounds } from './common.js';
import * as minimed780g from './minimed-780g.js';
import * as tslimX2 from './tslim-x2.js';
import * as mobi from './mobi.js';
import * as omnipod5 from './omnipod-5.js';
import * as ilet from './ilet.js';
import * as phone from './phone.js';

export const pumps = [minimed780g, tslimX2, mobi, omnipod5, ilet];
export { phone, bounds };

// Build one pump with the caller's THREE (browser CDN build or npm build).
// `companion: true` also stands the phone beside app-controlled pumps.
export function buildPump(THREE, pump, { companion = false } = {}) {
  const h = makeHelpers(THREE);
  const g = pump.build(h);
  g.name = pump.meta.id;
  if (companion && pump.companion) {
    const { side, rotationY, app } = pump.companion;
    const box = bounds(THREE, g);
    const p = phone.build(h, app);
    p.name = 'phone';
    p.userData.companion = true;
    const edge = side > 0 ? box.max.x : box.min.x;
    p.position.set(edge + side * (16 + 36), box.min.y + phone.meta.size[1] / 2, 0);
    p.rotation.y = rotationY;
    g.add(p);
  }
  return g;
}
