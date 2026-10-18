import type {
  BoxRegion,
  ButtonView,
  MeshAnnotations,
  RenderReply,
  RenderRequest,
} from '@infallible/contracts';
import * as THREE from 'three';

import {
  configureRenderer,
  eyePosition,
  FOCUS,
  FOV,
  loadPump,
  normalise,
  screenPlane,
  stage,
} from './deviceScene';

/** How far in front of a button face the occlusion ray stops (pump heights, ~1 mm). */
const FACE_CLEARANCE = 0.01;

/**
 * Offscreen render of the device as an agent sees it: the same scene as the
 * sandbox (no markers, labels or eye), the agent's live firmware screen on the
 * display, from the agent's eye. Independent of which view is open.
 */
export class Snapshotter {
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 60);
  private readonly pump = new THREE.Group();
  /** Raw mesh space: annotation anchors are expressed here (metres). */
  private readonly mesh = new THREE.Group();
  private readonly env: THREE.Texture;
  private readonly raycaster = new THREE.Raycaster();
  private meshSize = new THREE.Vector3(0.054, 0.097, 0.025);
  private screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private model: Promise<void> = Promise.resolve();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly annotations: MeshAnnotations) {
    configureRenderer(this.renderer);
    this.env = stage(this.renderer, this.scene);
    this.pump.add(this.mesh);
    this.scene.add(this.pump);
  }

  loadMesh(url: string | null): void {
    this.model = loadPump(url).then((root) => {
      if (!root) return;
      this.meshSize = normalise(this.pump, this.mesh, root);
      this.screen?.material.map?.dispose();
      this.screen = screenPlane(this.annotations.screen, this.meshSize, new THREE.Texture());
      this.mesh.add(this.screen);
    });
  }

  /** Serialised: every agent shares this scene's screen plane and canvas. */
  render(request: RenderRequest): Promise<RenderReply> {
    const reply = this.queue.then(() => this.renderNow(request));
    this.queue = reply.catch(() => undefined);
    return reply;
  }

  dispose(): void {
    this.screen?.material.map?.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private async renderNow(request: RenderRequest): Promise<RenderReply> {
    await this.model;
    const screen = this.screen;
    if (!screen) throw new Error('pump mesh not loaded');
    const map = await this.screenTexture(request.screen_png_b64, screen.geometry.parameters);
    screen.material.map?.dispose();
    screen.material.map = map;
    screen.material.needsUpdate = true;

    const { width: w, height: h } = request;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    eyePosition(request.pose, this.camera.position);
    this.camera.lookAt(FOCUS);
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    return {
      type: 'render_reply',
      id: request.id,
      png_b64: this.renderer.domElement.toDataURL('image/png').split(',', 2)[1] ?? '',
      buttons: this.annotations.buttons.map((b) => this.buttonView(b, w, h)),
    };
  }

  /** Firmware frame fitted inside the display (letterboxed, never stretched). */
  private async screenTexture(pngB64: string, plane: { width: number; height: number }) {
    const img = new Image();
    img.src = `data:image/png;base64,${pngB64}`;
    await img.decode();
    const aspect = plane.width / plane.height;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round(512 / aspect);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      const k = Math.min(c.width / img.width, c.height / img.height);
      const dw = img.width * k;
      const dh = img.height * k;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  private buttonView(b: BoxRegion, w: number, h: number): ButtonView {
    const hw = (b.w * this.meshSize.x) / 2;
    const hh = (b.h * this.meshSize.y) / 2;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [dx, dy] of [
      [-hw, -hh],
      [hw, -hh],
      [-hw, hh],
      [hw, hh],
    ] as const) {
      const p = this.mesh
        .localToWorld(new THREE.Vector3(b.anchor[0] + dx, b.anchor[1] + dy, b.anchor[2]))
        .project(this.camera);
      xs.push(((p.x + 1) / 2) * w);
      ys.push(((1 - p.y) / 2) * h);
    }

    // Button faces point along +Z in mesh space, like the sandbox markers.
    const anchor = this.mesh.localToWorld(new THREE.Vector3(...b.anchor));
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld);
    const eye = this.camera.position;
    const facing = normal.dot(eye.clone().sub(anchor)) > 0;

    const target = anchor.addScaledVector(normal, FACE_CLEARANCE);
    const dir = target.clone().sub(eye);
    this.raycaster.set(eye, dir.clone().normalize());
    this.raycaster.far = dir.length();
    const hits = this.raycaster.intersectObject(this.mesh, true);
    const occluded = hits.some((hit) => hit.object !== this.screen);

    return {
      id: b.id,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      facing,
      occluded,
    };
  }
}
