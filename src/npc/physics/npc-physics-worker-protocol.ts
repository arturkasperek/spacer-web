export type NpcIntent = {
  npcId: string;
  inputSeq: number;
  desiredX: number;
  desiredZ: number;
  jumpRequested: boolean;
};

export type NpcIntentBatchMessage = {
  type: "npc_intent_batch";
  frameId: number;
  sentAtMs: number;
  intents: NpcIntent[];
};

export type NpcWorkerInitMessage = {
  type: "npc_worker_init";
};

export type NpcWorkerStopMessage = {
  type: "npc_worker_stop";
};

export type NpcWorkerInboundMessage =
  | NpcIntentBatchMessage
  | NpcWorkerInitMessage
  | NpcWorkerStopMessage;

export type NpcSnapshotState = {
  npcId: string;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  falling: boolean;
  sliding: boolean;
  jumpActive: boolean;
};

export type NpcSnapshotMessage = {
  type: "npc_snapshot";
  simTick: number;
  simTimeMs: number;
  generatedAtMs: number;
  states: NpcSnapshotState[];
};

export type NpcWorkerOutboundMessage = NpcSnapshotMessage;
