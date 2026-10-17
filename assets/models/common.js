// Shared primitives for the pump models. Units are millimetres, +Y is up and
// +Z is the wearer-facing front. `THREE` is injected so the same modules run
// in the browser (CDN build) and in Node (npm build) for GLB export.
export function makeHelpers(THREE) {
  const mat = {
    plastic: (color, o = {}) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.5,
        clearcoat: 0.25,
        clearcoatRoughness: 0.4,
        ...o,
      }),
    gloss: (color, o = {}) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        ...o,
      }),
    metal: (color = 0xc9cbce, o = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 1, ...o }),
    glass: (color = 0xffffff, o = {}) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.05,
        clearcoat: 1,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        ...o,
      }),
    rubber: (color = 0x1c1c1e, o = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...o }),
    screenOff: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x06080c,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
      }),
    led: (color, on = true) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: on ? 1.5 : 0,
        roughness: 0.3,
      }),
  };

  function roundedRect(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2,
      y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r);
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h);
    s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r);
    s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  // Extrude output is unindexed (flat shaded); weld coincident vertices so
  // the bevels shade smoothly.
  function smooth(geom, tol = 1e-3) {
    const pos = geom.attributes.position;
    const map = new Map();
    const index = [];
    const out = [];
    const k = 1 / tol;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const key = `${Math.round(x * k)}_${Math.round(y * k)}_${Math.round(z * k)}`;
      let j = map.get(key);
      if (j === undefined) {
        j = out.length / 3;
        map.set(key, j);
        out.push(x, y, z);
      }
      index.push(j);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  // Rounded box: w×h in XY, d along Z. r = plan corner radius, e = edge radius.
  function slab(w, h, d, r, e, material, { curveSegments = 10, bevelSegments = 6 } = {}) {
    e = Math.min(e, d / 2 - 0.01, r - 0.01);
    const shape = roundedRect(w - 2 * e, h - 2 * e, r - e);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: d - 2 * e,
      bevelEnabled: true,
      bevelThickness: e,
      bevelSize: e,
      bevelSegments,
      curveSegments,
    });
    g.center();
    return new THREE.Mesh(smooth(g), material);
  }

  function cyl(r, h, material, { rTop = r, seg = 48 } = {}) {
    return new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg), material);
  }
  function sphere(r, material) {
    return new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), material);
  }
  function tube(points, r, material, { segments = 64, radial = 10 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    return new THREE.Mesh(new THREE.TubeGeometry(curve, segments, r, radial, false), material);
  }
  function at(obj, [x, y, z], [rx = 0, ry = 0, rz = 0] = []) {
    if (!obj) return null; // decals are skipped without a DOM
    obj.position.set(x, y, z);
    obj.rotation.set(rx, ry, rz);
    return obj;
  }
  function group(...children) {
    const g = new THREE.Group();
    for (const c of children) if (c) g.add(c);
    return g;
  }

  function canvas(w, h, draw) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  // Lit display. `draw(ctx, w, h)` paints the UI in pixels (res px per mm).
  function screen(w, h, draw, { res = 8, transparent = false } = {}) {
    const map = canvas(Math.round(w * res), Math.round(h * res), draw);
    const material = map
      ? new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent })
      : mat.screenOff();
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  }
  // Printed graphics on a surface. Returns null without a DOM (GLB export).
  function decal(w, h, draw, { res = 12 } = {}) {
    const map = canvas(Math.round(w * res), Math.round(h * res), draw);
    if (!map) return null;
    const material = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  }
  const text =
    (
      str,
      {
        color = '#fff',
        weight = 600,
        scale = 0.7,
        family = 'system-ui, sans-serif',
        style = '',
      } = {},
    ) =>
    (ctx, w, h) => {
      ctx.fillStyle = color;
      ctx.font = `${style} ${weight} ${Math.round(h * scale)}px ${family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(str, w / 2, h / 2);
    };

  // Luer-lock tubing connector standing on +Y from the group origin.
  function luerLock({ stub = 5, r = 2.8 } = {}) {
    const white = mat.plastic(0xf2f2ef, { transparent: true, opacity: 0.9, roughness: 0.35 });
    const g = group(
      at(cyl(r, stub, white), [0, stub / 2, 0]),
      at(cyl(r + 1.4, 3.4, white, { seg: 14 }), [0, stub + 1.7, 0]),
      at(cyl(1.7, 2.4, white), [0, stub + 4.4, 0]),
    );
    g.userData.top = stub + 5.4;
    return g;
  }
  // Short pigtail of infusion-set tubing (OD 1.8 mm) rising from `base`.
  function tubing(base, dir = 1) {
    const [x, y, z] = base;
    const m = mat.plastic(0xf6f6f3, { transparent: true, opacity: 0.8, roughness: 0.3 });
    const pts = [
      [x, y, z],
      [x, y + 10, z],
      [x + 2 * dir, y + 24, z + 3],
      [x + 9 * dir, y + 36, z + 9],
      [x + 20 * dir, y + 43, z + 13],
      [x + 32 * dir, y + 44, z + 12],
    ];
    const t = tube(pts, 0.9, m);
    const end = at(cyl(1.5, 4, mat.plastic(0xf2f2ef)), pts[pts.length - 1], [0, 0, Math.PI / 2]);
    const g = group(t, end);
    g.userData.fitIgnore = true; // keep the pigtail out of camera framing
    return g;
  }

  return {
    THREE,
    mat,
    roundedRect,
    smooth,
    slab,
    cyl,
    sphere,
    tube,
    at,
    group,
    canvas,
    screen,
    decal,
    text,
    luerLock,
    tubing,
  };
}

// World-space box of a built model. Tubing pigtails (fitIgnore) never count;
// companion assets count only when asked for.
export function bounds(THREE, group, { companion = false } = {}) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) {
      if (p.userData.fitIgnore) return;
      if (p.userData.companion && !companion) return;
    }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}
