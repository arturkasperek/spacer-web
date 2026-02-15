import * as THREE from "three";
import { disposeObject3D } from "./distance-streaming";
import {
  getFreepointReservationsSnapshot,
  getFreepointSpotsSnapshot,
} from "./npc/world/npc-freepoints";
import { createTextSprite } from "./mesh-utils";

type FreepointOwnerOverlay = {
  update: (enabled: boolean) => void;
  onWorldChanged: () => void;
  dispose: () => void;
};

function disposeTextSprite(sprite: THREE.Sprite): void {
  const mat: any = sprite.material as any;
  const tex: any = mat?.map;
  if (tex?.dispose) tex.dispose();
  if (mat?.dispose) mat.dispose();
}

export function createFreepointOwnerOverlay(scene: THREE.Scene): FreepointOwnerOverlay {
  let group: THREE.Group | null = null;
  const spritesBySpotId = new Map<number, { sprite: THREE.Sprite; text: string }>();
  let spotById: Map<number, { x: number; y: number; z: number }> | null = null;

  const ensureGroup = (): THREE.Group => {
    if (group) return group;
    const g = new THREE.Group();
    g.name = "FreepointOwners";
    scene.add(g);
    group = g;
    return g;
  };

  const ensureSpotCache = (): Map<number, { x: number; y: number; z: number }> => {
    if (spotById) return spotById;
    const map = new Map<number, { x: number; y: number; z: number }>();
    for (const s of getFreepointSpotsSnapshot()) {
      map.set(s.vobId, { x: s.position.x, y: s.position.y, z: s.position.z });
    }
    spotById = map;
    return map;
  };

  const clear = (): void => {
    if (!group) return;
    for (const entry of spritesBySpotId.values()) {
      group.remove(entry.sprite);
      disposeTextSprite(entry.sprite);
      disposeObject3D(entry.sprite);
    }
    spritesBySpotId.clear();
    scene.remove(group);
    group = null;
  };

  return {
    update(enabled: boolean) {
      if (!enabled) {
        clear();
        spotById = null;
        return;
      }

      const g = ensureGroup();
      const spotMap = ensureSpotCache();

      const reservations = getFreepointReservationsSnapshot();
      const keep = new Set<number>();

      for (const r of reservations) {
        const spot = spotMap.get(r.spotVobId);
        if (!spot) continue;
        keep.add(r.spotVobId);

        const text = String(r.byNpcInstanceIndex);
        const prev = spritesBySpotId.get(r.spotVobId);
        if (!prev || prev.text !== text) {
          if (prev) {
            g.remove(prev.sprite);
            disposeTextSprite(prev.sprite);
            disposeObject3D(prev.sprite);
          }
          const sprite = createTextSprite(text);
          sprite.position.set(spot.x, spot.y + 320, spot.z);
          sprite.scale.set(80, 20, 1);
          g.add(sprite);
          spritesBySpotId.set(r.spotVobId, { sprite, text });
        } else {
          prev.sprite.position.set(spot.x, spot.y + 320, spot.z);
        }
      }

      for (const [spotId, entry] of spritesBySpotId.entries()) {
        if (keep.has(spotId)) continue;
        g.remove(entry.sprite);
        disposeTextSprite(entry.sprite);
        disposeObject3D(entry.sprite);
        spritesBySpotId.delete(spotId);
      }
    },

    onWorldChanged() {
      spotById = null;
    },

    dispose() {
      clear();
      spotById = null;
    },
  };
}
