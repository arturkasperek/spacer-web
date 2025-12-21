import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopMenuBar } from "../top-menu-bar";
import { __resetViewSettingsForTests, getViewSettings } from "../view-settings";

describe("TopMenuBar", () => {
  beforeEach(() => {
    __resetViewSettingsForTests();
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
});

