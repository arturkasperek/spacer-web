import type { ZenKit, DaedalusScript, DaedalusVm } from '@kolarz3/zenkit';

export interface VmLoadResult {
  script: DaedalusScript;
  vm: DaedalusVm;
  npcNames: string[];
}

/**
 * Load Daedalus script from hardcoded path
 */
export async function loadDaedalusScript(
  zenKit: ZenKit,
  scriptPath: string = '/SCRIPTS/_COMPILED/GOTHIC.DAT'
): Promise<{ script: DaedalusScript; loadResult: any }> {
  const response = await fetch(scriptPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch script file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const script = zenKit.createDaedalusScript();
  const loadResult = script.loadFromArray(uint8Array);

  if (!loadResult.success) {
    throw new Error(`Failed to load script: ${script.getLastError() || 'Unknown error'}`);
  }

  return { script, loadResult };
}

/**
 * Create VM instance from loaded script
 */
export function createVm(zenKit: ZenKit, script: DaedalusScript): DaedalusVm {
  return zenKit.createDaedalusVm(script);
}

/**
 * Helper to register a single external function
 */
function registerExternalSafe(
  vm: DaedalusVm,
  funcName: string,
  callback: (...args: any[]) => any
): void {
  if (!vm.hasSymbol(funcName)) {
    return;
  }

  try {
    vm.registerExternal(funcName, callback);
  } catch (error) {
    // Function might not be external or already registered, ignore
    console.debug(`Could not register external ${funcName}:`, error);
  }
}

/**
 * Register empty external functions that are called during startup
 * These functions don't need to do anything in the web context
 */
export function registerEmptyExternals(vm: DaedalusVm): void {
  // Functions that return void
  const voidExternals = [
    'WLD_INSERTITEM',
    'WLD_INSERTNPC',
    'WLD_SETTIME',
    'WLD_ASSIGNROOMTOGUILD',
    'PLAYVIDEO',
    'CREATEINVITEMS',      // Create inventory items (not needed for VM inspection)
    'MDL_SETVISUAL',       // Set NPC visual model (not needed for VM inspection)
    'MDL_SETVISUALBODY',   // Set NPC visual body/head (not needed for VM inspection)
    'MDL_SETMODELSCALE',   // Set NPC model scale (not needed for VM inspection)
    'MDL_SETMODELFATNESS', // Set NPC model fatness (not needed for VM inspection)
    'MDL_APPLYOVERLAYMDS', // Apply overlay skeleton (not needed for VM inspection)
    'NPC_SETTALENTSKILL',  // Set NPC talent skill (not needed for VM inspection)
    'EQUIPITEM',           // Equip item on NPC (not needed for VM inspection)
  ];

  // Functions that return int (return 0/false)
  const intExternals = [
    'NPC_ISDEAD',
    'HLP_ISVALIDNPC',
  ];

  // Functions that return instance (return null)
  const instanceExternals = [
    'HLP_GETNPC',
  ];

  // Register void functions
  voidExternals.forEach(funcName => {
    registerExternalSafe(vm, funcName, () => {
      // Do nothing - empty implementation
    });
  });

  // Register int-returning functions (return 0)
  intExternals.forEach(funcName => {
    registerExternalSafe(vm, funcName, () => 0);
  });

  // Register instance-returning functions (return null instance object)
  // Must return an object with symbol_index: -1, not null, to avoid WASM binding errors
  instanceExternals.forEach(funcName => {
    registerExternalSafe(vm, funcName, () => ({ symbol_index: -1 }));
  });
}

/**
 * Call startup function in VM
 */
export function callStartupFunction(vm: DaedalusVm, functionName: string = 'startup_newworld'): boolean {
  if (!vm.hasSymbol(functionName)) {
    console.warn(`Startup function '${functionName}' not found in VM`);
    return false;
  }

  try {
    const callResult = vm.callFunction(functionName, []);
    if (!callResult.success) {
      console.error(`Failed to call startup function: ${callResult.errorMessage || 'Unknown error'}`);
      return false;
    }
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Exception calling startup function: ${errorMsg}`);
    return false;
  }
}

/**
 * Check if a symbol is an NPC instance by verifying it has NPC properties
 */
function isNpcInstance(vm: DaedalusVm, symbolName: string): boolean {
  if (!vm.hasSymbol(symbolName)) {
    return false;
  }

  try {
    // Try to get NAME property - NPCs should have this
    const name = vm.getSymbolString('NAME', symbolName);
    if (name !== undefined && name !== null) {
      return true; // Has NAME property, likely an NPC
    }
  } catch {
    // NAME property access failed, try ID instead
  }

  try {
    // Try to get ID property - NPCs should have this
    const id = vm.getSymbolInt('ID', symbolName);
    if (id !== undefined && id !== null) {
      return true; // Has ID property, likely an NPC
    }
  } catch {
    // ID property access failed
  }

  return false;
}

/**
 * Extract all NPC instance names from VM
 * Since we can't iterate symbols directly, we check known/common NPC instance names
 */
export function extractNpcNames(vm: DaedalusVm): string[] {
  const npcNames: string[] = [];

  // Common NPC instance name patterns to try
  const commonNpcPatterns = [
    'PC_HERO',
    'NONE_100_XARDAS',
    'PC_L10',
    'PC_L20',
    'PC_L30',
    'PC_L40',
    'PC_L50',
    'PC_L60',
    'PC_E3MAGE',
    'PC_E3PALADIN',
    'PC_BANDIT',
  ];

  // Check each pattern
  for (const symbolName of commonNpcPatterns) {
    if (isNpcInstance(vm, symbolName)) {
      npcNames.push(symbolName);
    }
  }

  // Since we can't iterate all symbols directly, we'll return what we found
  // In a full implementation, we'd need WASM bindings to iterate symbols
  return npcNames.sort((a, b) => a.localeCompare(b));
}

/**
 * Complete VM loading workflow
 */
export async function loadVm(
  zenKit: ZenKit,
  scriptPath: string = '/SCRIPTS/_COMPILED/GOTHIC.DAT',
  startupFunction: string = 'startup_newworld'
): Promise<VmLoadResult> {
  // Load script
  const { script } = await loadDaedalusScript(zenKit, scriptPath);

  // Create VM
  const vm = createVm(zenKit, script);

  // Register empty external functions to prevent warnings
  registerEmptyExternals(vm);

  // Call startup function
  callStartupFunction(vm, startupFunction);

  // Extract NPC names
  const npcNames = extractNpcNames(vm);

  return {
    script,
    vm,
    npcNames,
  };
}

