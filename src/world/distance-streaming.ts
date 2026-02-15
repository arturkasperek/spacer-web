// Distance-based streaming utility for loading/unloading objects based on camera distance
import * as THREE from "three";

export interface StreamableItem {
  id: string;
  position: THREE.Vector3;
}

export interface StreamingConfig {
  loadDistance: number;
  unloadDistance: number;
  updateThreshold: number; // Distance camera must move before updating
  updateInterval?: number; // Frames to skip between updates (default: 10)
}

export interface StreamingState {
  lastCameraPosition: { current: THREE.Vector3 };
  isFirstUpdate: { current: boolean };
  updateCounter: { current: number };
}

/**
 * Creates streaming state refs for distance-based loading
 */
export function createStreamingState(): StreamingState {
  return {
    lastCameraPosition: { current: new THREE.Vector3() },
    isFirstUpdate: { current: true },
    updateCounter: { current: 0 },
  };
}

/**
 * Checks if streaming should update based on camera movement
 * Returns true if update should happen, false otherwise
 */
export function shouldUpdateStreaming(
  state: StreamingState,
  cameraPosition: THREE.Vector3 | undefined,
  config: StreamingConfig,
): { shouldUpdate: boolean; cameraPos: THREE.Vector3 } {
  const camPos = cameraPosition || new THREE.Vector3(0, 0, 0);
  const updateInterval = config.updateInterval ?? 10;

  // Check if camera moved significantly OR if this is the first update
  const distance = state.lastCameraPosition.current.distanceTo(camPos);
  const shouldUpdate = state.isFirstUpdate.current || distance > config.updateThreshold;

  // Only run update every N frames, but always allow first update
  if (!state.isFirstUpdate.current && state.updateCounter.current % updateInterval !== 0) {
    state.updateCounter.current++;
    return { shouldUpdate: false, cameraPos: camPos };
  }
  state.updateCounter.current++;

  if (shouldUpdate) {
    state.isFirstUpdate.current = false;
    state.lastCameraPosition.current.copy(camPos);
  }

  return { shouldUpdate, cameraPos: camPos };
}

/**
 * Gets items to load/unload based on distance
 */
export function getItemsToLoadUnload<T extends StreamableItem>(
  items: T[],
  cameraPos: THREE.Vector3,
  config: StreamingConfig,
  loadedItems: Map<string, THREE.Object3D>,
): { toLoad: T[]; toUnload: string[] } {
  const toLoad: T[] = [];
  const toUnload: string[] = [];

  for (const item of items) {
    const itemDistance = cameraPos.distanceTo(item.position);
    const isLoaded = loadedItems.has(item.id);

    if (itemDistance < config.loadDistance && !isLoaded) {
      toLoad.push(item);
    } else if (itemDistance > config.unloadDistance && isLoaded) {
      toUnload.push(item.id);
    }
  }

  return { toLoad, toUnload };
}

/**
 * Helper function to dispose of a Three.js object and its resources
 */
export function disposeObject3D(object: THREE.Object3D): void {
  if (!object) return;

  // If it's a Mesh, dispose its geometry
  if ((object as THREE.Mesh).geometry) {
    (object as THREE.Mesh).geometry.dispose();
  }

  // If it's a Group or has children, recursively dispose children
  if (object.children && object.children.length > 0) {
    for (const child of object.children) {
      disposeObject3D(child);
    }
  }

  // Note: materials are cached and shared, don't dispose them
}
