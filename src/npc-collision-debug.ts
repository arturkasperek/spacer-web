let dumpSeq = 0;

export function requestNpcCollisionDump() {
  dumpSeq += 1;
}

export function getNpcCollisionDumpSeq() {
  return dumpSeq;
}

