import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { pumps, buildPump, bounds } from './models/index.js';

const stage = document.getElementById('stage');
const rail = document.getElementById('rail');
const spec = document.getElementById('spec');
const VIEWS = {
  front: { theta: -0.22, phi: 1.32 },
  iso: { theta: 0.7, phi: 1.05 },
  back: { theta: Math.PI - 0.22, phi: 1.32 },
  top: { theta: 0, phi: 0.12 },
};
const HALF_FOV = THREE.MathUtils.degToRad(15);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  stage.insertAdjacentHTML(
    'beforeend',
    '<p class="fallback">This browser cannot create a WebGL context, so the 3D view is unavailable.</p>',
  );
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = studioEnvironment(renderer);
const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);

const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(60, 130, 90);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, {
  left: -90,
  right: 90,
  top: 90,
  bottom: -90,
  near: 10,
  far: 400,
});
key.shadow.radius = 4;
key.shadow.bias = -0.0004;
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
fill.position.set(-80, 40, -60);
scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0x8a96a8, 0.45));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(600, 600),
  new THREE.ShadowMaterial({ opacity: 0.22 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
ground.receiveShadow = true;
const grid = new THREE.GridHelper(200, 20, 0x8a93a3, 0x8a93a3);
grid.material.transparent = true;
grid.material.opacity = 0.28;
scene.add(ground, grid);

// Soft-box studio baked to a PMREM so plastics and glass pick up real reflections.
function studioEnvironment(r) {
  const env = new THREE.Scene();
  const panel = (w, h, pos, rot, rgb) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(...rgb),
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.position.set(...pos);
    m.rotation.set(...rot);
    env.add(m);
  };
  env.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(80, 50, 80),
      new THREE.MeshBasicMaterial({ color: 0x2f333a, side: THREE.BackSide }),
    ),
  );
  panel(36, 22, [0, 24, 0], [Math.PI / 2, 0, 0], [5.5, 5.5, 5.5]);
  panel(14, 24, [-39, 6, 0], [0, Math.PI / 2, 0], [2.4, 2.6, 3.0]);
  panel(14, 24, [39, 4, 0], [0, -Math.PI / 2, 0], [2.0, 1.9, 1.7]);
  panel(40, 10, [0, 4, 39], [0, Math.PI, 0], [1.3, 1.3, 1.3]);
  const gen = new THREE.PMREMGenerator(r);
  const tex = gen.fromScene(env, 0.04).texture;
  gen.dispose();
  return tex;
}

// Minimal orbit controls with damping, wheel and pinch zoom.
const orbit = {
  theta: 0,
  phi: 1.3,
  radius: 300,
  target: new THREE.Vector3(),
  goal: { theta: 0, phi: 1.3, radius: 300 },
  dragging: false,
};
const pointers = new Map();
let pinchDist = 0;
const el = renderer.domElement;
const pinch = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
};
el.addEventListener('pointerdown', (e) => {
  el.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  orbit.dragging = true;
  if (pointers.size === 2) pinchDist = pinch();
});
el.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const [px, py] = pointers.get(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) {
    orbit.goal.theta -= (e.clientX - px) * 0.006;
    orbit.goal.phi = THREE.MathUtils.clamp(
      orbit.goal.phi - (e.clientY - py) * 0.006,
      0.05,
      Math.PI - 0.05,
    );
  } else if (pointers.size === 2) {
    const d = pinch();
    if (pinchDist)
      orbit.goal.radius = THREE.MathUtils.clamp(orbit.goal.radius * (pinchDist / d), 40, 1200);
    pinchDist = d;
  }
});
const release = (e) => {
  pointers.delete(e.pointerId);
  if (!pointers.size) orbit.dragging = false;
};
el.addEventListener('pointerup', release);
el.addEventListener('pointercancel', release);
el.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.goal.radius = THREE.MathUtils.clamp(
      orbit.goal.radius * Math.exp(e.deltaY * 0.0012),
      40,
      1200,
    );
  },
  { passive: false },
);

// Build all five up front; they are cheap and the rail needs thumbnails.
// The pump alone is centred on the ground; the companion phone, where one
// exists, stands beside it and only affects framing while shown.
const models = pumps.map((p) => {
  const g = buildPump(THREE, p, { companion: true });
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const box = bounds(THREE, g);
  const c = box.getCenter(new THREE.Vector3());
  g.position.set(-c.x, -box.min.y, -c.z);
  return { pump: p, group: g, phone: g.getObjectByName('phone') };
});

let current = -1;
let spinning = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let showPhone = true;

function framing(m, companion) {
  const box = bounds(THREE, m.group, { companion });
  return {
    center: box.getCenter(new THREE.Vector3()),
    radius: (box.getSize(new THREE.Vector3()).length() / 2 / Math.tan(HALF_FOV)) * 1.25,
  };
}

function setView(name, instant = false) {
  const v = VIEWS[name] || VIEWS.front;
  const m = models[current];
  const { center, radius } = framing(m, showPhone && !!m.phone);
  Object.assign(orbit.goal, { theta: v.theta, phi: v.phi, radius });
  orbit.target.copy(center);
  if (instant) Object.assign(orbit, { theta: v.theta, phi: v.phi, radius });
}

function select(i, instant = false) {
  const next = (i + models.length) % models.length;
  if (next === current) return;
  if (current >= 0) scene.remove(models[current].group);
  current = next;
  const m = models[current];
  if (m.phone) m.phone.visible = showPhone;
  phoneBtn.disabled = !m.phone;
  scene.add(m.group);
  setView(m.pump.meta.view, instant);
  [...rail.children].forEach((b, j) => b.setAttribute('aria-pressed', String(j === current)));
  renderSpec(m.pump);
  history.replaceState(null, '', `#${m.pump.meta.id}`);
}

function renderSpec({ meta: t, companion }) {
  const [w, l, d] = t.size;
  const rows = [
    ['Form', t.kind],
    ['Size', `${w} × ${l} × ${d} mm`, 'mono'],
    ['Weight', t.weight, 'mono'],
    ['Reservoir', t.reservoir],
    ['Display', t.display],
    ['Controls', t.controls],
    ['Power', t.power],
    ['Water', t.water, 'mono'],
    ['Notes', t.notes],
  ];
  if (companion)
    rows.splice(6, 0, [
      'App',
      `${companion.app.title} app on the companion phone shown beside the pump`,
    ]);
  const dl = rows.map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`).join('');
  spec.innerHTML = `<h2>${t.name}</h2><p class="maker">${t.maker}</p><dl>${dl}</dl>
    <p class="foot">Size is W × L × D from the manufacturer's spec sheet. Surface details, screen layout and colours are approximated from product photos.</p>`;
}

// Rail thumbnails come from the same renderer before the first frame.
function thumbnail(m) {
  renderer.setSize(176, 208, false);
  camera.aspect = 176 / 208;
  camera.updateProjectionMatrix();
  const v = m.pump.meta.view === 'iso' ? VIEWS.iso : { theta: -0.35, phi: 1.2 };
  const { center, radius } = framing(m, false);
  const r = radius * 0.92;
  camera.position
    .set(
      r * Math.sin(v.phi) * Math.sin(v.theta),
      r * Math.cos(v.phi),
      r * Math.sin(v.phi) * Math.cos(v.theta),
    )
    .add(center);
  camera.lookAt(center);
  grid.visible = false;
  if (m.phone) m.phone.visible = false;
  scene.add(m.group);
  renderer.render(scene, camera);
  scene.remove(m.group);
  grid.visible = true;
  return renderer.domElement.toDataURL('image/png');
}
models.forEach((m, i) => {
  const t = m.pump.meta;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'card';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<img alt="" src="${thumbnail(m)}"><span><span class="name">${t.name}</span><br><span class="maker">${t.maker}</span><br><span class="chip">${t.kind}</span></span>`;
  b.addEventListener('click', () => select(i));
  rail.append(b);
});

const spinBtn = document.getElementById('spin');
const phoneBtn = document.getElementById('phone');
spinBtn.setAttribute('aria-pressed', String(spinning));
function togglePhone() {
  showPhone = !showPhone;
  phoneBtn.setAttribute('aria-pressed', String(showPhone));
  const m = models[current];
  if (m.phone) {
    m.phone.visible = showPhone;
    setView(m.pump.meta.view);
  }
}
document.getElementById('toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.view) setView(b.dataset.view);
  else if (b.id === 'spin') b.setAttribute('aria-pressed', String((spinning = !spinning)));
  else if (b.id === 'grid') b.setAttribute('aria-pressed', String((grid.visible = !grid.visible)));
  else if (b.id === 'phone') togglePhone();
});
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') select(current + 1);
  else if (e.key === 'ArrowLeft') select(current - 1);
  else if (e.key >= '1' && e.key <= '5') select(+e.key - 1);
  else if (e.key.toLowerCase() === 'r') setView(models[current].pump.meta.view);
  else if (e.key.toLowerCase() === 'p' && models[current].phone) togglePhone();
  else if (e.key === ' ' && !e.target.closest('button')) {
    e.preventDefault();
    spinBtn.click();
  }
});

function resize() {
  const w = stage.clientWidth,
    h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

const start = models.findIndex((m) => `#${m.pump.meta.id}` === location.hash);
select(start >= 0 ? start : 0, true);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (spinning && !orbit.dragging) orbit.goal.theta += dt * 0.35;
  const k = 1 - Math.exp(-dt * 10);
  orbit.theta += (orbit.goal.theta - orbit.theta) * k;
  orbit.phi += (orbit.goal.phi - orbit.phi) * k;
  orbit.radius += (orbit.goal.radius - orbit.radius) * k;
  const { theta, phi, radius, target } = orbit;
  camera.position
    .set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    )
    .add(target);
  camera.lookAt(target);
  renderer.render(scene, camera);
});
