import type { Action, BoxRegion, MeshAnnotations, ProposedChange } from '@infallible/contracts';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import fallbackPumpUrl from '../../../../assets/models/glb/minimed-780g.glb?url';
import { type EyePose, INITIAL_POSE } from './eyePose';

export const FALLBACK_MESH_URL: string = fallbackPumpUrl;

const BG = 0xf7f6f3;
const INK = 0x141414;
const ACCENT = 0x2563eb;
const OK = 0x1f8a4c;
/** Pump centre after normalisation (height 1, standing on the grid). */
const FOCUS = new THREE.Vector3(0, 0.5, 0);
const HOME = new THREE.Vector3(2.025, 1.25, 3.075);
const UP = new THREE.Vector3(0, 1, 0);
/** Assumed real pump height (≈ a deck of cards); one scene unit is one pump height. */
const PUMP_HEIGHT_M = 0.09;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const damp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const ease = (k: number) => 1 - Math.pow(1 - k, 3);

interface Pulse {
  object: THREE.Object3D;
  born: number;
  life: number;
  update: (k: number) => void;
}

interface Marker {
  group: THREE.Group;
  plane: THREE.Mesh;
  fill: THREE.MeshBasicMaterial;
  home: THREE.Vector3;
  flash: number;
}

interface ChangeAnim {
  apply: (k: number) => void;
  dispose: () => void;
}

function lookAngles(from: THREE.Vector3, to: THREE.Vector3) {
  const f = to.clone().sub(from).normalize();
  return { yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(clamp(f.y, -1, 1)) };
}

function textTexture(
  text: string,
  { w = 256, h = 96, size = 44, bg = '#141414', fg = '#fff' } = {},
) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = `600 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function screenTexture(scale = 1, dialog: string | null = null) {
  const w = 360;
  const h = 480;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    const font = (px: number, wt = 600) =>
      (ctx.font = `${wt} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`);
    ctx.fillStyle = '#070a0f';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#aab3bd';
    font(20);
    ctx.textAlign = 'left';
    ctx.fillText('10:42', 20, 26);
    ctx.textAlign = 'right';
    ctx.fillText('245 U', w - 20, 26);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    font(Math.round(96 * scale), 700);
    ctx.fillText('121', w / 2 - 20, 150);
    ctx.fillStyle = '#aab3bd';
    font(Math.round(18 * scale));
    ctx.fillText('mg/dL', w / 2 + 92, 170);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = 20 + t * (w - 40);
      const y = 300 - 40 * Math.sin(t * 5 + 1) - 12 * Math.sin(t * 13) + 25 * t;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#aab3bd';
    font(16);
    ctx.textAlign = 'left';
    ctx.fillText('Active insulin', 20, 420);
    ctx.fillStyle = '#fff';
    font(Math.round(28 * scale), 700);
    ctx.fillText('1.2 U', 20, 452);
    if (dialog) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f7f6f3';
      ctx.beginPath();
      ctx.roundRect(30, 150, w - 60, 190, 18);
      ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.textAlign = 'center';
      font(24, 700);
      ctx.fillText(dialog, w / 2, 205);
      font(18, 500);
      ctx.fillStyle = '#6f6f6a';
      ctx.fillText('Deliver now?', w / 2, 245);
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.roundRect(50, 280, 120, 40, 20);
      ctx.fill();
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(190, 280, 120, 40, 20);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      font(18, 600);
      ctx.fillText('Yes', 110, 300);
      ctx.fillStyle = '#141414';
      ctx.fillText('No', 250, 300);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Axis-aligned bounds of a loaded model, skipping parts flagged `fitIgnore` (tubing). */
function fitBox(root: THREE.Object3D) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh;
  root.traverse((o) => {
    if (!isMesh(o)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (p.userData['fitIgnore'] === true) return;
    }
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}

/**
 * Editor-style sandbox: grid floor, fly camera (drag to look, WASD to move),
 * the pump normalised to one unit tall, annotation markers, the agent's eye,
 * and the animations for actions and proposed changes.
 */
export class Sandbox {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 60);
  private readonly pump = new THREE.Group();
  /** Raw mesh space: annotation anchors are expressed here (metres). */
  private readonly mesh = new THREE.Group();
  private readonly fx = new THREE.Group();
  private readonly eye = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly gaze: THREE.Line;
  private readonly markers = new Map<string, Marker>();
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(2, 2);
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly env: THREE.Texture;
  private readonly cleanup: (() => void)[] = [];
  private frame = 0;
  private last = performance.now();
  private yaw = 0;
  private pitch = 0;
  private tween: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  private pose: EyePose = INITIAL_POSE;
  private poseTarget: EyePose = INITIAL_POSE;
  private pulses: Pulse[] = [];
  private change: ChangeAnim | null = null;
  private changeSpec: ProposedChange | null = null;
  private changePhase = 0;
  private changeTarget = 0;
  private dragging = false;
  private hovered: Marker | null = null;
  private meshSize = new THREE.Vector3(0.054, 0.097, 0.025);
  private annotations: MeshAnnotations | null = null;
  private screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private loadId = 0;
  private orbit = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly interactive: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(BG);
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.9;

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 3, 2);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-2, 1, -1.5);
    this.scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0xb8b4ad, 0.5));

    this.scene.add(new THREE.GridHelper(8, 32, 0xc9c5be, 0xe0ddd6));

    this.pump.add(this.mesh);
    this.gaze = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({
        color: ACCENT,
        dashSize: 0.04,
        gapSize: 0.03,
        transparent: true,
        opacity: 0.7,
      }),
    );
    this.buildEye();
    this.eye.visible = false;
    this.gaze.visible = false;
    this.scene.add(this.pump, this.fx, this.eye, this.gaze);
    this.setPlaceholder();

    this.camera.position.copy(HOME);
    ({ yaw: this.yaw, pitch: this.pitch } = lookAngles(HOME, FOCUS));
    this.camera.rotation.order = 'YXZ';

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(container);
    this.resize();
    if (interactive) this.bindInput();
    this.loop(this.last);
  }

  /** Load a GLB (falling back to the bundled pump), normalise it to one unit tall. */
  async loadMesh(url: string | null): Promise<void> {
    const id = ++this.loadId;
    const loader = new GLTFLoader();
    let root: THREE.Object3D | null = null;
    for (const candidate of [url, FALLBACK_MESH_URL]) {
      if (!candidate) continue;
      try {
        root = (await loader.loadAsync(candidate)).scene;
        break;
      } catch (err: unknown) {
        console.warn('pump mesh failed to load', candidate, err);
      }
    }
    if (id !== this.loadId) return;
    if (root) this.setModel(root);
  }

  setAnnotations(annotations: MeshAnnotations | null): void {
    this.annotations = annotations;
    this.rebuildMarkers();
  }

  /** Move the agent's eye (tweened). */
  setPose(pose: EyePose, immediate = false): void {
    this.poseTarget = pose;
    if (immediate) this.pose = pose;
    this.eye.visible = true;
    this.gaze.visible = true;
  }

  hideEye(): void {
    this.eye.visible = false;
    this.gaze.visible = false;
  }

  /** One-shot animation for an action the agent just took. */
  play(action: Action): void {
    const now = performance.now();
    switch (action.kind) {
      case 'press':
      case 'hold':
        this.reach(action.button_id, action.kind === 'hold' ? 1.6 : 1, now);
        break;
      case 'turn':
        this.reach(action.dial, 1.2, now);
        break;
      case 'read_screen':
        this.flash('screen', now);
        break;
      case 'done':
        this.ripple(FOCUS.clone().setY(0.002), OK, now, 1.6);
        break;
      default:
        break;
    }
  }

  /** Show a proposed change; `setChangePhase(1)` animates it in. */
  setChange(change: ProposedChange | null): void {
    this.changeSpec = change;
    this.changePhase = 0;
    this.changeTarget = 0;
    this.rebuildChange();
  }

  /** Markers are recreated on every mesh load, so the change animation is too. */
  private rebuildChange() {
    this.change?.dispose();
    this.change = null;
    if (!this.changeSpec || !this.annotations) return;
    this.change = this.buildChange(this.changeSpec, this.annotations);
    this.change.apply(this.changePhase);
  }

  setChangePhase(k: number): void {
    this.changeTarget = clamp(k, 0, 1);
  }

  /** Fly the camera back to its home framing. */
  reframe(): void {
    this.tween = { pos: HOME.clone(), ...lookAngles(HOME, FOCUS) };
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    for (const off of this.cleanup) off();
    this.change?.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---- model ---------------------------------------------------------------

  private setPlaceholder() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.054, 0.097, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.5 }),
    );
    this.setModel(body);
  }

  private setModel(root: THREE.Object3D) {
    // Measure before parenting so the box is in mesh space, not the scaled world.
    const box = fitBox(root);
    this.mesh.clear();
    this.mesh.add(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.meshSize = size;
    const s = 1 / size.y;
    this.pump.scale.setScalar(s);
    this.mesh.position.set(-center.x, -box.min.y, -center.z);
    this.rebuildMarkers();
  }

  private rebuildMarkers() {
    this.change?.dispose();
    this.change = null;
    for (const m of this.markers.values()) m.group.removeFromParent();
    this.markers.clear();
    this.screen?.removeFromParent();
    this.screen = null;
    const ann = this.annotations;
    if (!ann) return;
    const { x: sx, y: sy } = this.meshSize;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(ann.screen.w * sx, ann.screen.h * sy),
      new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }),
    );
    screen.position.set(...ann.screen.anchor);
    screen.position.z += 0.00005;
    this.mesh.add(screen);
    this.screen = screen;
    for (const region of [ann.screen, ...ann.buttons]) this.addMarker(region, sx, sy);
    this.rebuildChange();
  }

  private addMarker(region: BoxRegion, sx: number, sy: number) {
    const w = region.w * sx;
    const h = region.h * sy;
    const group = new THREE.Group();
    const fill = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fill);
    plane.userData['markerId'] = region.id;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.35 }),
    );
    group.add(plane, edge);
    if (region.id !== 'screen') {
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: textTexture(region.id),
          transparent: true,
          opacity: 0.85,
          depthTest: false,
        }),
      );
      label.scale.set(0.012, 0.0045, 1);
      label.position.set(0, -h / 2 - 0.0035, 0.002);
      group.add(label);
    }
    group.position.set(...region.anchor);
    group.position.z += 0.0004;
    this.mesh.add(group);
    this.markers.set(region.id, {
      group,
      plane,
      fill,
      home: group.position.clone(),
      flash: -1e9,
    });
  }

  // ---- agent eye + effects -------------------------------------------------

  /**
   * Smooth mannequin bust of a 5'8" adult at real scale relative to the pump,
   * dimensions in metres: an egg head on a tapered neck over one revolved
   * shoulder shell. The eyes sit at the group origin so the pose places the
   * eyes rather than the head centre. The group yaws toward the pump, only the
   * head pitches. Object3D.lookAt points +Z at the target, so the face is the
   * +Z side.
   */
  private buildEye() {
    const u = 1 / PUMP_HEIGHT_M;
    const shell = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.35 });
    const lathe = (pts: [number, number][]) =>
      new THREE.LatheGeometry(
        pts.map(([r, y]) => new THREE.Vector2(r * u, y * u)),
        80,
      );

    // Egg profile: two quarter-ellipses sharing the widest ring, crown taller than chin.
    const egg: [number, number][] = [];
    for (let i = 0; i <= 56; i++) {
      const a = -Math.PI / 2 + (i / 56) * Math.PI;
      egg.push([0.075 * Math.cos(a), (a < 0 ? 0.125 : 0.088) * Math.sin(a)]);
    }
    // Head pivots about its centre, which sits behind the eyes.
    this.head.position.set(0, 0, -0.08 * u);
    const skull = new THREE.Mesh(lathe(egg), shell);
    skull.scale.z = 1.22;
    this.head.add(skull);

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 * u, 0.058 * u, 0.17 * u, 48),
      shell,
    );
    neck.position.set(0, -0.17 * u, -0.085 * u);

    // Flat base, chest wall, then a quarter-ellipse trapezius slope up to the neck.
    const torsoProfile: [number, number][] = [
      [0, -0.45],
      [0.205, -0.45],
      [0.216, -0.4],
      [0.226, -0.34],
      [0.23, -0.29],
    ];
    for (let i = 1; i <= 18; i++) {
      const a = (i / 18) * (Math.PI / 2);
      torsoProfile.push([0.055 + 0.175 * Math.cos(a), -0.29 + 0.1 * Math.sin(a)]);
    }
    torsoProfile.push([0.03, -0.187], [0, -0.186]);
    const torso = new THREE.Mesh(lathe(torsoProfile), shell);
    torso.position.z = -0.11 * u;
    torso.scale.z = 0.5;

    this.eye.add(neck, torso, this.head);
  }

  private eyePosition(pose: EyePose, out: THREE.Vector3) {
    const c = Math.cos(pose.pitch);
    return out.set(
      pose.radius * c * Math.sin(pose.yaw),
      FOCUS.y + pose.radius * Math.sin(pose.pitch),
      pose.radius * c * Math.cos(pose.yaw),
    );
  }

  private markerWorld(id: string) {
    const m = this.markers.get(id);
    if (!m) return null;
    const pos = m.group.getWorldPosition(new THREE.Vector3());
    const quat = m.group.getWorldQuaternion(new THREE.Quaternion());
    return { marker: m, pos, quat };
  }

  private flash(id: string, now: number) {
    const m = this.markers.get(id);
    if (m) m.flash = now;
  }

  /** A fingertip travels from the eye to the button, then the button pulses. */
  private reach(id: string, strength: number, now: number) {
    const target = this.markerWorld(id);
    if (!target) return;
    const from = this.eye.visible
      ? this.eye.getWorldPosition(new THREE.Vector3())
      : target.pos.clone().add(new THREE.Vector3(0, 0, 0.5));
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 20, 14),
      new THREE.MeshBasicMaterial({ color: ACCENT }),
    );
    const to = target.pos.clone();
    const life = 360;
    this.pulses.push({
      object: tip,
      born: now,
      life,
      update: (k) => {
        const e = ease(k);
        tip.position.lerpVectors(from, to, e);
        tip.position.y += Math.sin(e * Math.PI) * 0.08;
      },
    });
    this.fx.add(tip);
    setTimeout(() => {
      this.flash(id, performance.now());
      this.ripple(target.pos, ACCENT, performance.now(), strength, target.quat);
    }, life);
  }

  private ripple(
    at: THREE.Vector3,
    color: number,
    now: number,
    strength = 1,
    quat?: THREE.Quaternion,
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.038, 48), mat);
    ring.position.copy(at);
    if (quat) ring.quaternion.copy(quat);
    else ring.rotation.x = -Math.PI / 2;
    this.fx.add(ring);
    this.pulses.push({
      object: ring,
      born: now,
      life: 700 * strength,
      update: (k) => {
        ring.scale.setScalar(1 + ease(k) * 3 * strength);
        mat.opacity = 1 - k;
      },
    });
  }

  // ---- proposed changes ----------------------------------------------------

  private buildChange(change: ProposedChange, ann: MeshAnnotations): ChangeAnim {
    const params = change.params as Record<string, unknown>;
    const num = (key: string, fallback: number) => {
      const v = params[key];
      return typeof v === 'number' ? v : fallback;
    };
    const buttonId = typeof params['button_id'] === 'string' ? params['button_id'] : null;
    const onScreen = !['move_button', 'resize_button', 'relabel'].includes(change.type);
    const regionId = onScreen ? 'screen' : (buttonId ?? ann.buttons[0]?.id ?? 'screen');
    const marker = this.markers.get(regionId);
    const disposers: (() => void)[] = [];
    const steps: ((k: number) => void)[] = [];

    if (marker) {
      // Keep the impacted area blinking so it stays findable in either phase.
      steps.push(() => {
        marker.fill.opacity = 0.1 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 160));
      });
      disposers.push(() => {
        marker.fill.opacity = 0;
        marker.group.position.copy(marker.home);
        marker.group.scale.setScalar(1);
      });
    }

    switch (change.type) {
      case 'move_button': {
        if (!marker) break;
        const from = marker.home.clone();
        const to = from
          .clone()
          .add(
            new THREE.Vector3(num('dx', 0) * this.meshSize.x, num('dy', 0) * this.meshSize.y, 0),
          );
        const ghost = marker.group.clone(true);
        ghost.traverse((o) => {
          if (o instanceof THREE.Sprite) o.visible = false;
          if (o instanceof THREE.Mesh) o.visible = false;
          if (o instanceof THREE.LineSegments) {
            o.material = new THREE.LineDashedMaterial({
              color: INK,
              dashSize: 0.0015,
              gapSize: 0.001,
              transparent: true,
              opacity: 0.4,
            });
            o.computeLineDistances();
          }
        });
        this.mesh.add(ghost);
        disposers.push(() => {
          ghost.removeFromParent();
        });
        steps.push((k) => {
          marker.group.position.lerpVectors(from, to, ease(k));
          ghost.visible = k > 0.02;
        });
        break;
      }
      case 'resize_button': {
        if (!marker) break;
        const s = num('scale', 1.4);
        steps.push((k) => {
          marker.group.scale.setScalar(1 + (s - 1) * ease(k));
        });
        break;
      }
      case 'resize_text':
      case 'confirm_dialog':
      case 'relabel':
      case 'change_timeout': {
        const screen = this.screen;
        if (!screen) break;
        const scale = change.type === 'resize_text' ? num('scale', 1.5) : 1;
        const dialog =
          change.type === 'confirm_dialog'
            ? `Bolus ${num('threshold_units', 5)} U`
            : change.type === 'change_timeout'
              ? `Timeout ${num('ms', num('seconds', 30) * 1000) / 1000} s`
              : change.type === 'relabel'
                ? typeof params['label'] === 'string'
                  ? params['label']
                  : 'Relabel'
                : null;
        const before = screen.material.map;
        const after = screenTexture(scale, dialog);
        disposers.push(() => {
          screen.material.map = before;
          screen.material.needsUpdate = true;
          after.dispose();
        });
        let showing = false;
        steps.push((k) => {
          const want = k > 0.5;
          if (want !== showing) {
            showing = want;
            screen.material.map = want ? after : before;
            screen.material.needsUpdate = true;
          }
        });
        break;
      }
      case 'add_audio_cue': {
        let next = 0;
        steps.push((k) => {
          const now = performance.now();
          if (k > 0.9 && now > next) {
            next = now + 650;
            this.ripple(FOCUS.clone().setY(1.04), ACCENT, now, 1.4);
          }
        });
        break;
      }
    }

    return {
      apply: (k) => {
        for (const step of steps) step(k);
      },
      dispose: () => {
        for (const d of disposers) d();
      },
    };
  }

  // ---- input ----------------------------------------------------------------

  private bindInput() {
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    let lastX = 0;
    let lastY = 0;
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = true;
      this.tween = null;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      el.focus();
    };
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (!this.dragging) return;
      this.yaw -= (e.clientX - lastX) * 0.0038;
      this.pitch = clamp(this.pitch - (e.clientY - lastY) * 0.0038, -1.5, 1.5);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      this.dragging = false;
      el.classList.remove('dragging');
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onLeave = () => {
      this.pointer.set(2, 2);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.tween = null;
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      this.camera.position.addScaledVector(dir, -e.deltaY * 0.0022);
    };
    const onContext = (e: Event) => {
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.code === 'KeyF') {
        this.reframe();
        return;
      }
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const onBlur = () => {
      this.keys.clear();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanup.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private fly(dt: number) {
    const want = new THREE.Vector3();
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) want.z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) want.z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) want.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) want.x += 1;
    if (k.has('KeyE') || k.has('Space')) want.y += 1;
    if (k.has('KeyQ')) want.y -= 1;
    if (want.lengthSq() > 0) {
      this.tween = null;
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 4.5 : 1.6;
      const { x, y, z } = want.normalize();
      const forward = this.camera.getWorldDirection(new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
      want
        .set(0, 0, 0)
        .addScaledVector(forward, -z)
        .addScaledVector(right, x)
        .addScaledVector(UP, y)
        .multiplyScalar(speed);
    }
    this.velocity.lerp(want, damp(dt, 9));
    this.camera.position.addScaledVector(this.velocity, dt);
    this.camera.position.y = Math.max(this.camera.position.y, 0.05);
  }

  private hover() {
    if (!this.interactive || this.dragging) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const planes = [...this.markers.values()].map((m) => m.plane);
    const hit = this.raycaster.intersectObjects(planes, false)[0];
    const id = hit ? (hit.object.userData['markerId'] as string | undefined) : undefined;
    const next = id ? (this.markers.get(id) ?? null) : null;
    if (next !== this.hovered) {
      this.hovered = next;
      this.renderer.domElement.classList.toggle('hovering', next !== null);
    }
  }

  // ---- frame loop ------------------------------------------------------------

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.interactive) {
      this.fly(dt);
      this.hover();
    } else {
      this.orbit += dt * 0.18;
      this.camera.position.set(Math.sin(this.orbit) * 3.15, 1.175, Math.cos(this.orbit) * 3.15);
      ({ yaw: this.yaw, pitch: this.pitch } = lookAngles(this.camera.position, FOCUS));
    }
    if (this.tween) {
      const a = damp(dt, 5);
      this.camera.position.lerp(this.tween.pos, a);
      this.yaw += (this.tween.yaw - this.yaw) * a;
      this.pitch += (this.tween.pitch - this.pitch) * a;
      if (this.camera.position.distanceTo(this.tween.pos) < 0.002) this.tween = null;
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // agent eye
    const a = damp(dt, 6);
    this.pose = {
      yaw: this.pose.yaw + (this.poseTarget.yaw - this.pose.yaw) * a,
      pitch: this.pose.pitch + (this.poseTarget.pitch - this.pose.pitch) * a,
      radius: this.pose.radius + (this.poseTarget.radius - this.pose.radius) * a,
    };
    if (this.eye.visible) {
      const p = this.eyePosition(this.pose, this.eye.position);
      this.eye.rotation.set(0, Math.atan2(FOCUS.x - p.x, FOCUS.z - p.z), 0);
      this.eye.updateMatrixWorld();
      this.head.lookAt(FOCUS);
      const screenPos = this.markerWorld('screen')?.pos ?? FOCUS;
      this.gaze.geometry.setFromPoints([this.eye.position, screenPos]);
      this.gaze.computeLineDistances();
    }

    // marker flashes and hover
    for (const m of this.markers.values()) {
      const glow = Math.exp(-(now - m.flash) / 450) * 0.7;
      const hov = m === this.hovered ? 0.22 : 0;
      if (!this.change) m.fill.opacity = Math.max(glow, hov);
    }

    // one-shot effects
    this.pulses = this.pulses.filter((p) => {
      const k = (now - p.born) / p.life;
      if (k >= 1) {
        p.object.removeFromParent();
        return false;
      }
      p.update(k);
      return true;
    });

    if (this.change) {
      this.changePhase += (this.changeTarget - this.changePhase) * damp(dt, 4);
      this.change.apply(this.changePhase);
    }

    this.renderer.render(this.scene, this.camera);
  };
}
