import {
  buildWaynetGraph,
  findNearestWaypointIndex,
  findRouteAStar,
  findWaypointIndexByName,
} from "./waynet-pathfinding";

describe("waynet pathfinding", () => {
  it("buildWaynetGraph maps names case-insensitively", () => {
    const graph = buildWaynetGraph(
      [
        { name: "WP_A", position: { x: 0, y: 0, z: 0 } },
        { name: "wp_b", position: { x: 10, y: 0, z: 0 } },
      ],
      [],
    );

    expect(findWaypointIndexByName(graph, "wp_a")).toBe(0);
    expect(findWaypointIndexByName(graph, "WP_B")).toBe(1);
  });

  it("findNearestWaypointIndex returns closest by distance", () => {
    const graph = buildWaynetGraph(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 100, y: 0, z: 0 } },
        { name: "C", position: { x: 50, y: 0, z: 0 } },
      ],
      [],
    );

    expect(findNearestWaypointIndex(graph, { x: 49, y: 0, z: 0 })).toBe(2);
  });

  it("findRouteAStar returns a connected route", () => {
    const graph = buildWaynetGraph(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 10, y: 0, z: 0 } },
        { name: "C", position: { x: 20, y: 0, z: 0 } },
        { name: "D", position: { x: 100, y: 0, z: 0 } },
      ],
      [
        { waypoint_a_index: 0, waypoint_b_index: 1 },
        { waypoint_a_index: 1, waypoint_b_index: 2 },
        { waypoint_a_index: 2, waypoint_b_index: 3 },
      ],
    );

    const path = findRouteAStar(graph, 0, 3);
    expect(path).toEqual([0, 1, 2, 3]);
  });
});
