import { findActiveRoutineEntry, findActiveRoutineWaypoint } from "../npc-utils";
import type { RoutineEntry } from "../types";

const r = (p: Partial<RoutineEntry> & Pick<RoutineEntry, "start_h" | "stop_h" | "state" | "waypoint">): RoutineEntry => ({
  start_h: p.start_h,
  start_m: p.start_m,
  stop_h: p.stop_h,
  stop_m: p.stop_m,
  state: p.state,
  waypoint: p.waypoint,
});

describe("npc-utils routines", () => {
  test("returns null with no routines", () => {
    expect(findActiveRoutineEntry(undefined, 10, 0)).toBeNull();
    expect(findActiveRoutineWaypoint(undefined, 10, 0)).toBeNull();
    expect(findActiveRoutineEntry([], 10, 0)).toBeNull();
  });

  test("selects the active routine (non-wrapping)", () => {
    const routines: RoutineEntry[] = [
      r({ start_h: 8, start_m: 0, stop_h: 12, stop_m: 0, state: "zs_a", waypoint: "WP_A" }),
      r({ start_h: 12, start_m: 0, stop_h: 22, stop_m: 0, state: "zs_b", waypoint: "WP_B" }),
    ];

    expect(findActiveRoutineWaypoint(routines, 9, 0)).toBe("WP_A");
    expect(findActiveRoutineWaypoint(routines, 12, 0)).toBe("WP_B");
    expect(findActiveRoutineWaypoint(routines, 21, 59)).toBe("WP_B");
    expect(findActiveRoutineWaypoint(routines, 22, 0)).toBeNull();
  });

  test("handles wrap-around routines (across midnight)", () => {
    const routines: RoutineEntry[] = [
      r({ start_h: 22, start_m: 0, stop_h: 8, stop_m: 0, state: "zs_sleep", waypoint: "WP_SLEEP" }),
    ];

    expect(findActiveRoutineWaypoint(routines, 23, 0)).toBe("WP_SLEEP");
    expect(findActiveRoutineWaypoint(routines, 1, 0)).toBe("WP_SLEEP");
    expect(findActiveRoutineWaypoint(routines, 7, 59)).toBe("WP_SLEEP");
    expect(findActiveRoutineWaypoint(routines, 8, 0)).toBeNull();
    expect(findActiveRoutineWaypoint(routines, 21, 59)).toBeNull();
  });

  test("uses minute precision when provided", () => {
    const routines: RoutineEntry[] = [
      r({ start_h: 7, start_m: 30, stop_h: 8, stop_m: 15, state: "zs_mid", waypoint: "WP_MID" }),
    ];

    expect(findActiveRoutineWaypoint(routines, 7, 29)).toBeNull();
    expect(findActiveRoutineWaypoint(routines, 7, 30)).toBe("WP_MID");
    expect(findActiveRoutineWaypoint(routines, 8, 14)).toBe("WP_MID");
    expect(findActiveRoutineWaypoint(routines, 8, 15)).toBeNull();
  });
});

export {};

