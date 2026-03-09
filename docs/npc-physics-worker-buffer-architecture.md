# NPC Physics on Worker: Buffer-Based Architecture

## Goal

Przenieść fizykę NPC (w tym Rapier KCC) do Web Workera, tak aby:

- odciążyć main thread,
- utrzymać płynny render bez jittera,
- zaakceptować kontrolowane opóźnienie 1-2 klatek.

## Core Idea

System opiera się na 2 buforach danych:

1. `IntentBuffer` (main -> worker): intencje sterowania/ruchu.
2. `StateBuffer` (worker -> main): snapshoty stanu policzone przez fizykę.

Main thread renderuje z niewielkim opóźnieniem (`interpolationDelay`) i interpoluje pomiędzy snapshotami.

## Threads and Responsibilities

### Main Thread

- React + R3F + Three.js.
- UI, kamera, animacje renderowe, input.
- Wysyła intencje (`IntentBuffer`) do workera.
- Odbiera snapshoty (`StateBuffer`) i aplikuje interpolowane pozycje/rotacje do `npcGroup`.

### Worker Thread

- Jedna autorytatywna instancja Rapiera dla NPC.
- Fixed-step symulacja (np. 60 Hz).
- KCC + kolizje + stany ruchu NPC (`grounded/falling/sliding/jump`).
- Publikuje snapshoty stanu do main thread.

## Buffer Model

## `IntentBuffer`

Zawiera najnowsze intencje na NPC, np.:

- `npcId`
- `inputSeq`
- `moveIntent` (`desiredX/desiredZ` lub `dir/speed`)
- `jumpRequested`
- `timestampMs`

Uwagi:

- Intencje nie muszą być wysyłane co frame, jeśli się nie zmieniają.
- Zalecany heartbeat (np. co 50-100 ms), aby worker wiedział, że intent jest nadal aktywny.
- Worker powinien wygasić intent po timeout (failsafe).

## `StateBuffer`

Ring buffer snapshotów z workera:

- `simTick`
- `simTimeMs`
- `npcStates[]`:
- `id`
- `position` (`x, y, z`)
- `rotation` (`quat`)
- `velocity` (`vx, vy, vz`)
- flagi stanu (`grounded`, `falling`, `sliding`, `jumpActive`)

Uwagi:

- Snapshoty publikowane np. 30 lub 60 Hz.
- Rozmiar ring buffera: 64-128 snapshotów.

## Timing and Interpolation

### Worker Simulation Loop

- Fixed timestep: `dt = 1/60`.
- Accumulator (`while accumulator >= dt`) i stepy Rapiera.
- Po stepie: zapis snapshotu do `StateBuffer`.

### Main Render Loop

- Działa z częstotliwością renderu (`useFrame`).
- Liczy `renderTime = now - interpolationDelayMs` (np. 33-50 ms).
- Szuka w `StateBuffer` snapshotów `S0` i `S1` takich, że:
- `S0.time <= renderTime <= S1.time`
- Interpoluje:
- pozycja: `lerp(S0.pos, S1.pos, alpha)`
- rotacja: `slerp(S0.rot, S1.rot, alpha)`

Fallback:

- jeśli brak `S1`, krótka ekstrapolacja (np. max 100 ms) lub soft-snap do ostatniego stanu.

## Message Protocol (TypeScript Sketch)

```ts
// main -> worker
type NpcPhysicsIntentMsg = {
  type: "npc_intent_batch";
  frameId: number;
  sentAtMs: number;
  intents: Array<{
    npcId: string;
    inputSeq: number;
    desiredX: number;
    desiredZ: number;
    jumpRequested: boolean;
  }>;
};

// worker -> main
type NpcPhysicsSnapshotMsg = {
  type: "npc_snapshot";
  simTick: number;
  simTimeMs: number;
  generatedAtMs: number;
  states: Array<{
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
  }>;
};
```

## Integration with Current NPC Pipeline

Aktualnie `useFrame -> tickNpc -> applyMoveConstraint` jest synchroniczne na main thread.

Po migracji:

1. `tickNpc` na main liczy tylko intent (target/steering/input).
2. `applyMoveConstraint` + Rapier/KCC przeniesione do workera.
3. Main nie decyduje finalnej pozycji fizycznej; tylko renderuje wynik z `StateBuffer`.

## World/Collider Data Strategy

Docelowa strategia: **Full world/collider domain dla NPC w workerze**.

To oznacza:

1. Worker trzyma autorytatywną instancję Rapiera dla domeny NPC.
2. Worker buduje pełen zestaw colliderów świata potrzebnych do NPC (world + voby kolizyjne).
3. Main thread nie liczy fizyki NPC, tylko renderuje snapshoty.
4. Main thread wysyła do workera jedynie:
- intencje (`IntentBuffer`),
- dynamiczne dane wymagane przez NPC (np. proxy pozycji gracza, zdarzenia gameplayowe).

Powód wyboru:

- najmniejsze ryzyko desync fizyki,
- prostsza diagnostyka (jedna prawda o stanie NPC),
- najlepsza skalowalność CPU przy większych tłumach.

Niezalecane:

- dwa pełne, stale synchronizowane światy Rapiera z tą samą domeną odpowiedzialności.

## Jitter Prevention Rules

1. Fixed timestep po stronie worker.
2. Interpolacja po stronie render (nie bezpośredni snap do ostatniego snapshotu).
3. Stały `interpolationDelay` (zwykle 1-2 ticki).
4. Monotoniczny `simTick` i odrzucanie starych/out-of-order snapshotów.
5. Soft-correction przy większym drift (zamiast twardego teleportu).

## Testing Requirement

Mechanizm kliszy (`StateBuffer`/interpolacja/fallbacki) powinien być **gęsto pokryty testami jednostkowymi**.

Minimalny zakres UT:

1. Ring buffer overwrite i poprawność indeksowania.
2. Dobór pary snapshotów `S0/S1` dla `renderTime`.
3. Interpolacja (`lerp`/`slerp`) dla typowych i brzegowych `alpha` (`0`, `1`, out-of-range clamp).
4. Obsługa `drop` (brak snapshotu pośredniego).
5. Obsługa `out-of-order` (odrzucanie starych ticków).
6. Fallback: krótka ekstrapolacja i soft-correction.
7. Stabilność przy nieregularnym `delta` renderu.

## Rollout Plan (Phased)

1. `Phase 1`: Worker skeleton
- kanał `IntentBuffer` + `StateBuffer` bez Rapiera (mock movement).

2. `Phase 2`: Rapier in worker
- przeniesienie KCC i ruchu NPC.
- załadowanie pełnego świata colliderów dla domeny NPC do workera.
- render nadal na main z interpolacją snapshotów.

3. `Phase 3`: Hardening
- timeout intentów, reconnect, snapshot drop handling, profiling.

4. `Phase 4`: Hybrid control split
- hero pozostaje na lokalnym Rapier/KCC (main thread),
- NPC (non-hero) pozostają worker-driven,
- cel: zachować poprawne kolizje/grawitację hero przy utrzymaniu odciążenia main thread dla tłumu NPC.

### Phase 3 Implementation Notes

Aktualnie wdrożone:

1. Intent timeout w runtime worker (`intentTimeoutMs`) - stary intent jest wygaszany do `stop`.
2. Auto-reconnect klienta workera:
- reconnect po `worker.onerror` i `worker.onmessageerror`,
- reconnect przy stale snapshotach podczas aktywnego streamu intentów (`snapshotStaleMs`).
3. Snapshot hardening:
- odrzucanie out-of-order (`simTick` <= latest),
- liczenie gapów ticków (`drop`), max obserwowany gap.
4. Profiling/diagnostics:
- klient udostępnia liczniki (`reconnectCount`, `workerErrorCount`, `snapshotReceivedCount`, `snapshotOutOfOrderCount`, `snapshotDropGapCount`, `maxObservedTickGap`, ostatnie czasy snapshot/intent).
5. UT:
- reconnect flow po error,
- reconnect flow po stale snapshot,
- zliczanie `drop` i `out-of-order`.

## Acceptance Criteria

1. Brak widocznego jittera NPC przy 60 FPS.
2. Main thread ma niższy CPU frame cost w scenach z wieloma NPC.
3. Opóźnienie sterowania NPC stabilne i przewidywalne (docelowo ~1 klatka, akceptowalne 1-2).
4. Brak desync stanu `grounded/falling/sliding` względem animacji.
