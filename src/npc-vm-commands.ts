export type NpcVmCommand =
  | { type: "gotoFreepoint"; npcInstanceIndex: number; freepointName: string; checkDistance: boolean; dist?: number }
  | { type: "alignToFreepoint"; npcInstanceIndex: number };

const queue: NpcVmCommand[] = [];

export function enqueueNpcVmCommand(cmd: NpcVmCommand): void {
  queue.push(cmd);
}

export function drainNpcVmCommands(): NpcVmCommand[] {
  if (queue.length === 0) return [];
  const out = queue.slice();
  queue.length = 0;
  return out;
}
