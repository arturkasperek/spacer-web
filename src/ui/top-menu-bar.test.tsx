import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopMenuBar } from "./top-menu-bar";
import { __resetViewSettingsForTests, getViewSettings } from "./view-settings";
import { __resetCameraSettingsForTests, getCameraSettings } from "../camera/camera-settings";
import { __resetUiSettingsForTests, getUiSettings } from "./ui-settings";

describe("TopMenuBar", () => {
  beforeEach(() => {
    __resetViewSettingsForTests();
    __resetCameraSettingsForTests();
    __resetUiSettingsForTests();
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
    expect(screen.getByRole("menuitemcheckbox", { name: /waypoints/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    const wasmMem = screen.getByRole("menuitemcheckbox", { name: /wasm mem diagnose/i });
    expect(wasmMem).toHaveAttribute("aria-checked", "false");
    await user.click(wasmMem);
    expect(getViewSettings().showWasmMemDiagnose).toBe(true);
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

  it("triggers save camera position action from Camera menu", async () => {
    const user = userEvent.setup();
    const onSaveCameraPose = jest.fn();
    render(<TopMenuBar onSaveCameraPose={onSaveCameraPose} />);

    await user.click(screen.getByTestId("top-menu-camera"));
    await user.click(screen.getByRole("menuitem", { name: /save camera position/i }));

    expect(onSaveCameraPose).toHaveBeenCalledTimes(1);
  });

  it("toggles UI panels from View menu", async () => {
    const user = userEvent.setup();
    render(<TopMenuBar />);

    await user.click(screen.getByTestId("top-menu-view"));

    const vobTree = screen.getByRole("menuitemcheckbox", { name: /vob tree/i });
    expect(vobTree).toHaveAttribute("aria-checked", "true");
    await user.click(vobTree);
    expect(getUiSettings().showVobTree).toBe(false);

    const timeBar = screen.getByRole("menuitemcheckbox", { name: /time bar/i });
    expect(timeBar).toHaveAttribute("aria-checked", "true");
    await user.click(timeBar);
    expect(getUiSettings().showStatusBar).toBe(false);
  });
});
