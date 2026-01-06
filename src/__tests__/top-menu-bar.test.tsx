import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopMenuBar } from "../top-menu-bar";
import { __resetViewSettingsForTests, getViewSettings } from "../view-settings";
import { __resetCameraSettingsForTests, getCameraSettings } from "../camera-settings";

describe("TopMenuBar", () => {
  beforeEach(() => {
    __resetViewSettingsForTests();
    __resetCameraSettingsForTests();
  });

  it("toggles view settings from View menu", async () => {
    const user = userEvent.setup();
    render(<TopMenuBar />);

    await user.click(screen.getByTestId("top-menu-view"));

    const waypoints = screen.getByRole("menuitemcheckbox", { name: /waypoints/i });
    expect(waypoints).toHaveAttribute("aria-checked", "true");

    await user.click(waypoints);
    expect(getViewSettings().showWaypoints).toBe(false);

    // Menu stays open; checkbox reflects the state.
    expect(screen.getByRole("menuitemcheckbox", { name: /waypoints/i })).toHaveAttribute("aria-checked", "false");
  });

  it("closes the menu on outside click", async () => {
    const user = userEvent.setup();
    render(<TopMenuBar />);

    await user.click(screen.getByTestId("top-menu-view"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles free camera from Camera menu", async () => {
    const user = userEvent.setup();
    render(<TopMenuBar />);

    await user.click(screen.getByTestId("top-menu-camera"));

    const freeCam = screen.getByRole("menuitemcheckbox", { name: /free camera/i });
    expect(freeCam).toHaveAttribute("aria-checked", "false");

    await user.click(freeCam);
    expect(getCameraSettings().freeCamera).toBe(true);
  });
});
