import { getNpcVisualStateByInstanceIndex, getNpcVisualStateVersion, loadVm } from "./vm-manager";

type VmMock = {
  symbolCount: number;
  hasSymbol: jest.Mock;
  registerExternal: jest.Mock;
  setGlobalSelf: jest.Mock;
  setGlobalOther: jest.Mock;
  setGlobalHero: jest.Mock;
  setSymbolInstance: jest.Mock;
  initInstanceByIndex: jest.Mock;
  callFunction: jest.Mock;
  getSymbolNameByIndex: jest.Mock;
  getSymbolString: jest.Mock;
  getSymbolInt: jest.Mock;
};

function createVmMock(options?: {
  symbols?: Record<number, string>;
  hasSymbolNames?: string[];
}): VmMock {
  const symbols = options?.symbols ?? {};
  const hasSymbolNames = new Set(options?.hasSymbolNames ?? []);

  return {
    symbolCount: Math.max(1, ...Object.keys(symbols).map((v) => Number(v) + 1)),
    hasSymbol: jest.fn((name: string) => hasSymbolNames.has(name)),
    registerExternal: jest.fn(() => ({ success: true })),
    setGlobalSelf: jest.fn(() => ({ success: true })),
    setGlobalOther: jest.fn(() => ({ success: true })),
    setGlobalHero: jest.fn(() => ({ success: true })),
    setSymbolInstance: jest.fn(() => ({ success: true })),
    initInstanceByIndex: jest.fn(() => ({ success: true, data: { symbol_index: 0 } })),
    callFunction: jest.fn(() => ({ success: true })),
    getSymbolNameByIndex: jest.fn((i: number) =>
      symbols[i] ? { success: true, data: symbols[i] } : { success: false, errorMessage: "n/a" },
    ),
    getSymbolString: jest.fn(() => ""),
    getSymbolInt: jest.fn(() => 0),
  };
}

function createZenKitMock(vm: VmMock) {
  const script = {
    loadFromArray: jest.fn(() => ({ success: true })),
    getLastError: jest.fn(() => ""),
  };
  return {
    script,
    zenKit: {
      createDaedalusScript: jest.fn(() => script),
      createDaedalusVm: jest.fn(() => vm),
    },
  };
}

describe("loadVm", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    global.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })) as any;
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "debug").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  it("calls startup and matching init, without manual b_init* fallback calls", async () => {
    const vm = createVmMock({
      symbols: {
        11471: "PC_HERO",
        1620: "HERO",
      },
      hasSymbolNames: [
        "NONE_100_XARDAS",
        "PC_HERO",
        "HERO",
        "startup_newworld",
        "init_newworld",
        "b_initmonsterattitudes",
        "b_initguildattitudes",
        "b_initnpcglobals",
      ],
    });
    const { zenKit } = createZenKitMock(vm);

    await loadVm(zenKit as any, "/SCRIPTS/_COMPILED/GOTHIC.DAT", "startup_newworld");

    expect(vm.callFunction).toHaveBeenCalledWith("startup_newworld", []);
    expect(vm.callFunction).toHaveBeenCalledWith("init_newworld", []);
    expect(vm.callFunction).not.toHaveBeenCalledWith("b_initmonsterattitudes", []);
    expect(vm.callFunction).not.toHaveBeenCalledWith("b_initguildattitudes", []);
    expect(vm.callFunction).not.toHaveBeenCalledWith("b_initnpcglobals", []);
  });

  it("prebinds hero globals to PC_HERO using new ZenKit APIs", async () => {
    const vm = createVmMock({
      symbols: {
        11471: "PC_HERO",
        1620: "HERO",
      },
      hasSymbolNames: ["NONE_100_XARDAS", "PC_HERO", "HERO", "startup_newworld", "init_newworld"],
    });
    const { zenKit } = createZenKitMock(vm);

    await loadVm(zenKit as any, "/SCRIPTS/_COMPILED/GOTHIC.DAT", "startup_newworld");

    expect(vm.initInstanceByIndex).toHaveBeenCalledWith(11471);
    expect(vm.setGlobalHero).toHaveBeenCalledWith("PC_HERO");
    expect(vm.setSymbolInstance).toHaveBeenCalledWith("HERO", "PC_HERO");
  });

  it("emits onItemSpawn from Wld_InsertItem external", async () => {
    const vm = createVmMock({
      symbols: {
        11471: "PC_HERO",
        7812: "ITWR_STONEPLATECOMMON_ADDON",
      },
      hasSymbolNames: [
        "NONE_100_XARDAS",
        "PC_HERO",
        "startup_newworld",
        "init_newworld",
        "Wld_InsertItem",
      ],
    });

    // Simulate script calling Wld_InsertItem during startup.
    vm.callFunction.mockImplementation((fn: string) => {
      if (fn === "startup_newworld") {
        const insertCall = vm.registerExternal.mock.calls.find(
          (c: any[]) => c[0] === "Wld_InsertItem",
        );
        if (insertCall) {
          const cb = insertCall[1] as (itemInstanceIndex: number, spawnpoint: string) => void;
          cb(7812, "FP_ITEM_XARDAS_STPLATE_01");
        }
      }
      return { success: true };
    });

    const { zenKit } = createZenKitMock(vm);
    const onItemSpawn = jest.fn();

    await loadVm(
      zenKit as any,
      "/SCRIPTS/_COMPILED/GOTHIC.DAT",
      "startup_newworld",
      undefined,
      onItemSpawn,
    );

    expect(onItemSpawn).toHaveBeenCalledWith({
      instanceIndex: 7812,
      symbolName: "ITWR_STONEPLATECOMMON_ADDON",
      spawnpoint: "FP_ITEM_XARDAS_STPLATE_01",
    });
  });

  it("bumps npc visual state version only when Mdl_SetVisual/Mdl_SetVisualBody actually change state", async () => {
    const vm = createVmMock({
      symbols: {
        11471: "PC_HERO",
        12000: "MEATBUG",
      },
      hasSymbolNames: [
        "NONE_100_XARDAS",
        "PC_HERO",
        "startup_newworld",
        "Mdl_SetVisual",
        "Mdl_SetVisualBody",
      ],
    });

    vm.callFunction.mockImplementation((fn: string) => {
      if (fn === "startup_newworld") {
        const setVisual = vm.registerExternal.mock.calls.find(
          (c: any[]) => c[0] === "Mdl_SetVisual",
        )?.[1] as ((npc: any, mdsName: string) => void) | undefined;
        const setVisualBody = vm.registerExternal.mock.calls.find(
          (c: any[]) => c[0] === "Mdl_SetVisualBody",
        )?.[1] as
          | ((
              npc: any,
              body_mesh: string,
              body_tex: number,
              skin: number,
              head_mesh: string,
              head_tex: number,
              teeth_tex: number,
              armor_inst: number,
            ) => void)
          | undefined;

        setVisual?.({ symbol_index: 12000 }, "Meatbug.mds");
        setVisualBody?.({ symbol_index: 12000 }, "Mbg_Body", 0, 0, "", 0, 0, -1);

        // Repeat same data - version should not bump again.
        setVisual?.({ symbol_index: 12000 }, "Meatbug.mds");
        setVisualBody?.({ symbol_index: 12000 }, "Mbg_Body", 0, 0, "", 0, 0, -1);

        // Change body mesh - should bump.
        setVisualBody?.({ symbol_index: 12000 }, "Mbg_Body_Alt", 0, 0, "", 0, 0, -1);
      }
      return { success: true };
    });

    const { zenKit } = createZenKitMock(vm);

    await loadVm(zenKit as any, "/SCRIPTS/_COMPILED/GOTHIC.DAT", "startup_newworld");

    expect(getNpcVisualStateVersion(12000)).toBe(3);
  });

  it("marks npc visual state ready only after both SetVisual and SetVisualBody", async () => {
    const vm = createVmMock({
      symbols: {
        11471: "PC_HERO",
        13000: "MEATBUG",
      },
      hasSymbolNames: [
        "NONE_100_XARDAS",
        "PC_HERO",
        "startup_newworld",
        "Mdl_SetVisual",
        "Mdl_SetVisualBody",
      ],
    });

    const readinessSnapshots: Array<{
      isReady: boolean;
      hasSetVisual: boolean;
      hasSetVisualBody: boolean;
    }> = [];

    vm.callFunction.mockImplementation((fn: string) => {
      if (fn === "startup_newworld") {
        const setVisual = vm.registerExternal.mock.calls.find(
          (c: any[]) => c[0] === "Mdl_SetVisual",
        )?.[1] as ((npc: any, mdsName: string) => void) | undefined;
        const setVisualBody = vm.registerExternal.mock.calls.find(
          (c: any[]) => c[0] === "Mdl_SetVisualBody",
        )?.[1] as
          | ((
              npc: any,
              body_mesh: string,
              body_tex: number,
              skin: number,
              head_mesh: string,
              head_tex: number,
              teeth_tex: number,
              armor_inst: number,
            ) => void)
          | undefined;

        setVisual?.({ symbol_index: 13000 }, "Meatbug.mds");
        const afterVisual = getNpcVisualStateByInstanceIndex(13000);
        readinessSnapshots.push({
          isReady: afterVisual?.isReady === true,
          hasSetVisual: afterVisual?.hasSetVisual === true,
          hasSetVisualBody: afterVisual?.hasSetVisualBody === true,
        });

        setVisualBody?.({ symbol_index: 13000 }, "Mbg_Body", 0, 0, "", 0, 0, -1);
        const afterBody = getNpcVisualStateByInstanceIndex(13000);
        readinessSnapshots.push({
          isReady: afterBody?.isReady === true,
          hasSetVisual: afterBody?.hasSetVisual === true,
          hasSetVisualBody: afterBody?.hasSetVisualBody === true,
        });
      }
      return { success: true };
    });

    const { zenKit } = createZenKitMock(vm);
    await loadVm(zenKit as any, "/SCRIPTS/_COMPILED/GOTHIC.DAT", "startup_newworld");

    expect(readinessSnapshots).toEqual([
      {
        isReady: false,
        hasSetVisual: true,
        hasSetVisualBody: false,
      },
      {
        isReady: true,
        hasSetVisual: true,
        hasSetVisualBody: true,
      },
    ]);
  });
});
