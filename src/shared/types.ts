/**
 * Common types for the application
 */

export interface RoutineEntry {
  start_h: number;
  start_m?: number;
  stop_h: number;
  stop_m?: number;
  state: string;
  waypoint: string;
}

export interface NpcData {
  spawnRuntimeId?: number;
  instanceIndex: number;
  symbolName: string;
  name?: string;
  spawnpoint: string;
  npcInfo: Record<string, any>;
  dailyRoutine?: RoutineEntry[];
  visual?: NpcVisual;
}

export interface NpcVisual {
  bodyMesh: string;
  bodyTex: number;
  skin: number;
  headMesh: string;
  headTex: number;
  teethTex: number;
  armorInst: number;
}

export interface NpcVisualState {
  baseScript: string;
  overlays: string[];
  hasExplicitBaseScript: boolean;
  hasSetVisual: boolean;
  hasSetVisualBody: boolean;
  isReady: boolean;
  visual: NpcVisual;
}

export interface SpawnedItemData {
  spawnRuntimeId?: number;
  instanceIndex: number;
  symbolName: string;
  spawnpoint: string;
}

/**
 * NPC spawn callback type
 */
export type NpcSpawnCallback = (npcData: NpcData) => void;
export type ItemSpawnCallback = (itemData: SpawnedItemData) => void;
