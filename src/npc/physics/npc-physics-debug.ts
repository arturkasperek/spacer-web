import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export type JumpDebugRay = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  hit: boolean;
};

export function npcPhysicsDebugLog(...args: unknown[]) {
  console.log(...args);
}

export function updateNpcDebugRayLine(
  npcGroup: THREE.Group,
  key: string,
  color: number,
  width: number,
  startWorld: THREE.Vector3,
  endWorld: THREE.Vector3,
  visible: boolean,
) {
  if (npcGroup.userData == null) npcGroup.userData = {};
  let line = npcGroup.userData[key] as Line2 | undefined;
  if (!line) {
    const geometry = new LineGeometry();
    const material = new LineMaterial({ color, linewidth: width, depthTest: false });
    if (typeof window !== "undefined")
      material.resolution.set(window.innerWidth, window.innerHeight);
    line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    line.renderOrder = 9999;
    npcGroup.add(line);
    npcGroup.userData[key] = line;
  }
  line.visible = visible;
  if (!visible) return;
  if (typeof window !== "undefined") {
    const mat = line.material as LineMaterial;
    mat.resolution.set(window.innerWidth, window.innerHeight);
  }
  const start = (
    (npcGroup.userData._kccProbeStart as THREE.Vector3 | undefined) ??
    (npcGroup.userData._kccProbeStart = new THREE.Vector3())
  ).copy(startWorld);
  const end = (
    (npcGroup.userData._kccProbeEnd as THREE.Vector3 | undefined) ??
    (npcGroup.userData._kccProbeEnd = new THREE.Vector3())
  ).copy(endWorld);
  npcGroup.worldToLocal(start);
  npcGroup.worldToLocal(end);
  (line.geometry as LineGeometry).setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
  line.computeLineDistances();
}

export function updateNpcDebugPoint(
  npcGroup: THREE.Object3D,
  key: string,
  color: number,
  radius: number,
  position: THREE.Vector3,
  visible: boolean,
) {
  if (npcGroup.userData == null) npcGroup.userData = {};
  let mesh = npcGroup.userData[key] as THREE.Mesh | undefined;
  const cached = npcGroup.userData[`${key}_r`] as number | undefined;
  if (!mesh || cached !== radius) {
    if (mesh) {
      try {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      } catch {
        // ignore
      }
      npcGroup.remove(mesh);
    }
    const geom = new THREE.SphereGeometry(radius, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 9999;
    mesh.frustumCulled = false;
    npcGroup.add(mesh);
    npcGroup.userData[key] = mesh;
    npcGroup.userData[`${key}_r`] = radius;
  }
  mesh.visible = visible;
  if (!visible) return;
  const local = position.clone();
  npcGroup.worldToLocal(local);
  mesh.position.copy(local);
}

export function updateNpcDebugCapsuleWire(
  npcGroup: THREE.Group,
  radius: number,
  height: number,
  color: number,
  visible: boolean,
) {
  if (npcGroup.userData == null) npcGroup.userData = {};
  let wire = npcGroup.userData._kccCapsuleWire as THREE.LineSegments | undefined;
  const cached = npcGroup.userData._kccCapsuleWireDims as { r: number; h: number } | undefined;
  if (!wire || !cached || cached.r !== radius || cached.h !== height) {
    if (wire) {
      try {
        wire.geometry.dispose();
        (wire.material as THREE.Material).dispose();
      } catch {
        // ignore
      }
      npcGroup.remove(wire);
    }
    const length = Math.max(0.001, height - radius * 2);
    const geom = new THREE.CapsuleGeometry(radius, length, 6, 12);
    const wireGeom = new THREE.WireframeGeometry(geom);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
    wire = new THREE.LineSegments(wireGeom, mat);
    wire.frustumCulled = false;
    wire.renderOrder = 9998;
    npcGroup.add(wire);
    npcGroup.userData._kccCapsuleWire = wire;
    npcGroup.userData._kccCapsuleWireDims = { r: radius, h: height };
  }
  wire.visible = visible;
  if (!visible) return;
  wire.position.set(0, height / 2, 0);
}

export function updateNpcDebugJumpScanRays(
  npcGroup: THREE.Group,
  rays: JumpDebugRay[],
  visible: boolean,
) {
  if (npcGroup.userData == null) npcGroup.userData = {};
  let group = npcGroup.userData._kccJumpScanRayGroup as THREE.Group | undefined;
  let pool = npcGroup.userData._kccJumpScanRayPool as Line2[] | undefined;
  if (!group) {
    group = new THREE.Group();
    group.name = "kcc-jump-scan-rays";
    group.visible = false;
    npcGroup.add(group);
    npcGroup.userData._kccJumpScanRayGroup = group;
  }
  if (!pool) {
    pool = [];
    npcGroup.userData._kccJumpScanRayPool = pool;
  }
  group.visible = visible;
  if (!visible) return;

  const ensureLine = (idx: number) => {
    let line = pool![idx];
    if (line) return line;
    const geometry = new LineGeometry();
    const material = new LineMaterial({ color: 0x2ddf2d, linewidth: 2, depthTest: false });
    if (typeof window !== "undefined")
      material.resolution.set(window.innerWidth, window.innerHeight);
    line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    line.renderOrder = 9998;
    group!.add(line);
    pool![idx] = line;
    return line;
  };

  for (let i = 0; i < rays.length; i++) {
    const line = ensureLine(i);
    const mat = line.material as LineMaterial;
    if (typeof window !== "undefined") mat.resolution.set(window.innerWidth, window.innerHeight);
    mat.color.setHex(rays[i].hit ? 0xff2f2f : 0x2ddf2d);
    mat.linewidth = 2;

    const s = rays[i].start.clone();
    const e = rays[i].end.clone();
    npcGroup.worldToLocal(s);
    npcGroup.worldToLocal(e);
    (line.geometry as LineGeometry).setPositions([s.x, s.y, s.z, e.x, e.y, e.z]);
    line.computeLineDistances();
    line.visible = true;
  }
  for (let i = rays.length; i < pool.length; i++) {
    pool[i].visible = false;
  }
}
