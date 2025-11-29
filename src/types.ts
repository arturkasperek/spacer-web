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
    instanceIndex: number;
    symbolName: string;
    name?: string;
    spawnpoint: string;
    npcInfo: Record<string, any>;
    dailyRoutine?: RoutineEntry[];
}

/**
 * NPC spawn callback type
 */
export type NpcSpawnCallback = (npcData: NpcData) => void;
