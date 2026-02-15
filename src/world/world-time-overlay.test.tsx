import { render, fireEvent, screen } from "@testing-library/react";
import { WorldTimeOverlay } from "./world-time-overlay";
import { __resetWorldTimeForTests, setWorldTime } from "./world-time";

describe("WorldTimeOverlay", () => {
  beforeEach(() => {
    __resetWorldTimeForTests();
  });

  it("opens editor on click and applies day/hour changes", () => {
    setWorldTime(0, 10, 0);
    render(<WorldTimeOverlay />);

    fireEvent.click(screen.getByTestId("world-time-display"));
    expect(screen.getByTestId("world-time-day")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("world-time-day"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("world-time-hour"), { target: { value: "13" } });
    fireEvent.change(screen.getByTestId("world-time-minute"), { target: { value: "45" } });
    fireEvent.click(screen.getByTestId("world-time-apply"));

    expect(screen.getByTestId("world-time-display").textContent).toContain("Day 2 13:45");
  });
});
