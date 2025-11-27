import type { ZenKit, DaedalusScript, DaedalusVm } from '@kolarz3/zenkit';

export interface VmLoadResult {
  script: DaedalusScript;
  vm: DaedalusVm;
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
 * Get NPC information from VM by instance symbol index
 * Uses qualified class names to access properties after initialization
 */
function getNpcInfo(vm: DaedalusVm, npcInstanceIndex: number): Record<string, any> {
  const info: Record<string, any> = {
    instanceIndex: npcInstanceIndex,
  };

  // Initialize the instance explicitly - this executes the instance definition code
  const initResult = vm.initInstanceByIndex(npcInstanceIndex);
  if (!initResult.success) {
    console.warn(`⚠️  Failed to initialize NPC instance ${npcInstanceIndex}: ${initResult.errorMessage}`);
    // Continue trying to read properties even if initialization failed, as some might be static
  }

  // Get symbol name from index
  const nameResult = vm.getSymbolNameByIndex(npcInstanceIndex);
  if (nameResult.success && nameResult.data) {
    info.symbolName = nameResult.data;
    
    // Get NPC properties using qualified class names
    // Properties are available after initialization
    const properties = [
      { qualified: 'C_NPC.name', type: 'string', key: 'name' },
      { qualified: 'C_NPC.id', type: 'int', key: 'id' },
      { qualified: 'C_NPC.guild', type: 'int', key: 'guild' },
      { qualified: 'C_NPC.level', type: 'int', key: 'level' },
      { qualified: 'C_NPC.attribute[ATR_HITPOINTS]', type: 'int', key: 'hp' },
      { qualified: 'C_NPC.attribute[ATR_HITPOINTS_MAX]', type: 'int', key: 'hpmax' },
    ];
    
    for (const prop of properties) {
      try {
        if (prop.type === 'string') {
          const value = vm.getSymbolString(prop.qualified, nameResult.data);
          if (value && value.trim() !== '') {
            info[prop.key] = value;
          }
        } else {
          const value = vm.getSymbolInt(prop.qualified, nameResult.data);
          if (value !== undefined && value !== null) {
            info[prop.key] = value;
          }
        }
      } catch (e) {
        // Property access failed, skip
      }
    }
  }

  return info;
}

/**
 * Register external functions with specific implementations
 */
export function registerVmExternals(vm: DaedalusVm): void {
  // Register WLD_INSERTNPC with detailed logging implementation
  registerExternalSafe(vm, 'WLD_INSERTNPC', (npcInstanceIndex: number, spawnpoint: string) => {
    if (npcInstanceIndex <= 0) {
      console.warn(`⚠️  WLD_INSERTNPC: Invalid NPC instance index: ${npcInstanceIndex}`);
      return;
    }
    
    const npcInfo = getNpcInfo(vm, npcInstanceIndex);
    
    // Format output similar to test script
    const nameStr = npcInfo.symbolName || `NPC[${npcInstanceIndex}]`;
    const details = [];
    
    if (npcInfo.name && npcInfo.name.trim() !== '') {
      details.push(`Name: "${npcInfo.name}"`);
    }
    if (npcInfo.id !== undefined && npcInfo.id !== null) {
      details.push(`ID: ${npcInfo.id}`);
    }
    if (npcInfo.guild !== undefined && npcInfo.guild !== null) {
      details.push(`Guild: ${npcInfo.guild}`);
    }
    if (npcInfo.level !== undefined && npcInfo.level !== null) {
      details.push(`Level: ${npcInfo.level}`);
    }
    if (npcInfo.hp !== undefined && npcInfo.hpmax !== undefined && 
        (npcInfo.hp !== 0 || npcInfo.hpmax !== 0)) {
      details.push(`HP: ${npcInfo.hp}/${npcInfo.hpmax}`);
    }
    
    const detailsStr = details.length > 0 ? ` (${details.join(', ')})` : '';
    console.log(`👤 WLD_INSERTNPC: ${nameStr} at "${spawnpoint}"${detailsStr}`);
  });
}

/**
 * Register empty/no-op external functions to prevent warnings
 * These functions don't have specific implementations yet
 */
export function registerEmptyExternals(vm: DaedalusVm): void {
  // Functions that return void - called during startup/initialization
  const voidExternals = [
    'WLD_INSERTITEM',
    'WLD_SETTIME',
    'WLD_ASSIGNROOMTOGUILD',
    'PLAYVIDEO',
    'CREATEINVITEMS',
    'CREATEINVITEM',
    'MDL_SETVISUAL',
    'MDL_SETVISUALBODY',
    'MDL_SETMODELSCALE',
    'MDL_SETMODELFATNESS',
    'MDL_APPLYOVERLAYMDS',
    'NPC_SETTALENTSKILL',
    'NPC_SETTOFISTMODE',
    'NPC_SETTOFIGHTMODE',
    'EQUIPITEM',
  ];

  // Additional externals needed for instance initialization
  const initExternals = [
    'B_SETATTRIBUTESTOCHAPTER', // Set attributes to chapter (void)
    'B_CREATEAMBIENTINV',       // Create ambient inventory (void)
    'B_SETNPCVISUAL',           // Set NPC visual (void)
    'B_GIVENPCTALENTS',         // Give NPC talents (void)
    'B_SETFIGHTSKILLS',         // Set fight skills (void)
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
      // Empty implementation
    });
  });

  // Register initialization externals (void)
  initExternals.forEach(funcName => {
    registerExternalSafe(vm, funcName, () => {
      // Empty implementation for void functions
    });
  });

  // Register HLP_RANDOM (returns int)
  registerExternalSafe(vm, 'HLP_RANDOM', () => {
    return Math.floor(Math.random() * 100);
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

  // Register external functions with specific implementations
  registerVmExternals(vm);

  // Register empty external functions to prevent warnings
  registerEmptyExternals(vm);

  // Set up global context variables (self and other)
  // These are used by some scripts during initialization
  const selfNpcName = 'NONE_100_XARDAS';
  const otherNpcName = 'PC_HERO';
  
  if (vm.hasSymbol(selfNpcName)) {
    vm.setGlobalSelf(selfNpcName);
  }
  if (vm.hasSymbol(otherNpcName)) {
    vm.setGlobalOther(otherNpcName);
  }

  // Call startup function
  callStartupFunction(vm, startupFunction);

  return {
    script,
    vm,
  };
}

