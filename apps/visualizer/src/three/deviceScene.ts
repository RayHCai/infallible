import type { BoxRegion, EyePose } from '@infallible/contracts';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import fallbackPumpUrl from '../../../../assets/models/glb/minimed-780g.glb?url';

/**
 * The device scene shared by the interactive sandbox and the agents' snapshot
 * renderer, so an agent sees exactly what the sandbox shows.
 */

const FALLBACK_MESH_URL: string = fallbackPumpUrl;
const BG = 0xf7f6f3;
export const FOV = 42;
/** Pump centre after normalisation (height 1, standing on the grid). */
export const FOCUS = new THREE.Vector3(0, 0.5, 0);

export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(BG);
}

/** Environment, lights and floor. Returns the env map for the caller to dispose. */
export function stage(renderer: THREE.WebGLRenderer, scene: THREE.Scene): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.9;

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 3, 2);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(-2, 1, -1.5);
  scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0xb8b4ad, 0.5));
  scene.add(new THREE.GridHelper(8, 32, 0xc9c5be, 0xe0ddd6));
  return env;
}

/** Load a GLB, falling back to the bundled pump. */
export async function loadPump(url: string | null): Promise<THREE.Object3D | null> {
  const loader = new GLTFLoader();
  for (const candidate of [url, FALLBACK_MESH_URL]) {
    if (!candidate) continue;
    try {
      return (await loader.loadAsync(candidate)).scene;
    } catch (err: unknown) {
      console.warn('pump mesh failed to load', candidate, err);
    }
  }
  return null;
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
 * Put `root` in `mesh` (raw mesh space, where annotation anchors live) and scale
 * `pump` so the device is one unit tall, centred, standing on the grid.
 * Returns the mesh-space size that annotation w/h fractions refer to.
 */
export function normalise(pump: THREE.Group, mesh: THREE.Group, root: THREE.Object3D) {
  // Measure before parenting so the box is in mesh space, not the scaled world.
  const box = fitBox(root);
  mesh.clear();
  mesh.add(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  pump.scale.setScalar(1 / size.y);
  mesh.position.set(-center.x, -box.min.y, -center.z);
  return size;
}

/** The display plane over the annotated screen region, in mesh space. */
export function screenPlane(region: BoxRegion, meshSize: THREE.Vector3, map: THREE.Texture) {
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(region.w * meshSize.x, region.h * meshSize.y),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }),
  );
  screen.position.set(...region.anchor);
  screen.position.z += 0.00005;
  return screen;
}

export function eyePosition(pose: EyePose, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pose.pitch);
  return out.set(
    pose.radius * c * Math.sin(pose.yaw),
    FOCUS.y + pose.radius * Math.sin(pose.pitch),
    pose.radius * c * Math.cos(pose.yaw),
  );
}
