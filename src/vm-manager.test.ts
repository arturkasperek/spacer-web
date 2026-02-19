import { loadVm } from "./vm-manager";

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
});
