export type NpcDebugMark = {
  capturedAtMs: number;
  npcId: string;
  instanceIndex: number;
  symbolName: string;
  displayName: string;
  worldPos: { x: number; y: number; z: number };
  worldQuat: { x: number; y: number; z: number; w: number };
  cameraPos?: { x: number; y: number; z: number };
  groundYTarget?: number;
};

type State = {
  markSeq: number;
  dumpSeq: number;
  lastMark: NpcDebugMark | null;
};

const state: State = {
  markSeq: 0,
  dumpSeq: 0,
  lastMark: null,
};

export function requestNpcDebugMark(): void {
  state.markSeq += 1;
}

export function requestNpcDebugDump(): void {
  state.dumpSeq += 1;
}

export function getNpcDebugRequestSeq(): { markSeq: number; dumpSeq: number } {
  return { markSeq: state.markSeq, dumpSeq: state.dumpSeq };
}

export function setNpcDebugMark(mark: NpcDebugMark | null): void {
  state.lastMark = mark;
}

export function getNpcDebugMark(): NpcDebugMark | null {
  return state.lastMark;
}

