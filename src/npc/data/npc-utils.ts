// NPC utility functions for routine processing and mesh creation
import * as THREE from "three";
import type { NpcData, RoutineEntry } from "../../shared/types";
import { createTextSprite } from "../../shared/mesh-utils";

function createDynamicHudTextSprite(initialText: string): {
  sprite: THREE.Sprite;
  setText: (text: string) => void;
} {
  if (typeof document === "undefined") {
    throw new Error("document is not available");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context");
  }

  canvas.width = 256;
  canvas.height = 64;

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    depthTest: false,
    depthWrite: false,
  } as any);

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(80, 20, 1);

  let lastText = "";
  const draw = (text: string) => {
    const t = String(text ?? "");
    if (t === lastText) return;
    lastText = t;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fontSize = 26;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 4;
    ctx.strokeText(t, canvas.width / 2, canvas.height / 2);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(t, canvas.width / 2, canvas.height / 2);

    texture.needsUpdate = true;
  };

  draw(initialText);
  return { sprite, setText: draw };
}

/**
 * Find the active routine entry at a given time (hour:minute).
 */
export function findActiveRoutineEntry(
  routines: RoutineEntry[] | undefined,
  hour: number,
  minute: number = 0,
): RoutineEntry | null {
  if (!routines || routines.length === 0) return null;

  const currentTime = hour * 60 + minute;

  for (const routine of routines) {
    const startM = routine.start_h * 60 + (routine.start_m ?? 0);
    const stopM = routine.stop_h * 60 + (routine.stop_m ?? 0);

    // Handle routines that wrap around midnight (end < start)
    const isActive =
      stopM < startM
        ? currentTime >= startM || currentTime < stopM
        : currentTime >= startM && currentTime < stopM;

    if (isActive) return routine;
  }

  return null;
}

/**
 * Returns the waypoint name from the active routine, or null if no routine is active.
 */
export function findActiveRoutineWaypoint(
  routines: RoutineEntry[] | undefined,
  hour: number,
  minute: number = 0,
): string | null {
  const entry = findActiveRoutineEntry(routines, hour, minute);
  return entry?.waypoint ?? null;
}

/**
 * Helper to create a stable key from Map for React dependencies
 */
export function getMapKey(npcs: Map<number, NpcData>): string {
  const entries = Array.from(npcs.entries());
  entries.sort((a, b) => a[0] - b[0]); // Sort by instance index
  return entries.map(([idx, data]) => `${idx}:${data.spawnpoint}`).join("|");
}

/**
 * Create NPC mesh (box + text sprite) imperatively
 */
export function createNpcMesh(
  npcData: NpcData,
  position: THREE.Vector3,
  rotation?: THREE.Quaternion,
): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(position);

  // Apply rotation if provided (from waypoint direction)
  if (rotation) {
    group.quaternion.copy(rotation);
  }

  // Separate visual root so we can smooth rendering without desyncing physics/collision transforms.
  const visualRoot = new THREE.Group();
  visualRoot.name = "npc-visual-root";
  group.add(visualRoot);

  // Placeholder while real model loads
  const boxGeometry = new THREE.BoxGeometry(20, 60, 20);
  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.25,
  });
  const placeholder = new THREE.Mesh(boxGeometry, boxMaterial);
  placeholder.name = "npc-placeholder";
  placeholder.position.y = 30;
  visualRoot.add(placeholder);

  // Create text sprite
  const displayName = npcData.name || npcData.symbolName;
  let labelY = 120;
  try {
    const textSprite = createTextSprite(displayName);
    textSprite.position.y = labelY;
    visualRoot.add(textSprite);
  } catch (error) {
    console.warn(`Failed to create text sprite for NPC ${displayName}:`, error);
  }

  // Simple HP bar (updated per-frame in npc-renderer)
  const HEALTH_BAR_WIDTH = 90;
  const HEALTH_BAR_HEIGHT = 10;
  const healthBarRoot = new THREE.Group();
  healthBarRoot.name = "npc-healthbar-root";
  healthBarRoot.position.y = labelY + 18;
  visualRoot.add(healthBarRoot);

  const bgGeom = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.55,
  });
  const bg = new THREE.Mesh(bgGeom, bgMat);
  bg.name = "npc-healthbar-bg";
  healthBarRoot.add(bg);

  const fillGeom = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH - 2, HEALTH_BAR_HEIGHT - 2);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0xcc0000,
    transparent: true,
    opacity: 0.9,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);
  fill.name = "npc-healthbar-fg";
  fill.position.z = 0.1;
  healthBarRoot.add(fill);

  let hpTextSprite: THREE.Sprite | undefined;
  let setHpText: ((text: string) => void) | undefined;
  try {
    const hpText = createDynamicHudTextSprite("0/0");
    hpTextSprite = hpText.sprite;
    hpTextSprite.name = "npc-healthbar-text";
    hpTextSprite.position.y = 0;
    hpTextSprite.position.z = 0.2;
    healthBarRoot.add(hpTextSprite);
    setHpText = hpText.setText;
  } catch {
    // ignore (no DOM / canvas)
  }

  // Store NPC data in userData
  group.userData.npcData = npcData;
  group.userData.isNpc = true;
  group.userData.visualRoot = visualRoot;
  group.userData.healthBar = {
    root: healthBarRoot,
    fill,
    width: HEALTH_BAR_WIDTH - 2,
    textSprite: hpTextSprite,
    setText: setHpText,
  };

  return group;
}
