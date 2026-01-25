import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';

interface CameraDebugState {
  bestRangeOverride: number | null;
  bestElevationOverride: number | null;
  bestAzimuthOverride: number | null;
  rotOffsetXOverride: number | null;
  rotOffsetYOverride: number | null;
  veloTransOverride: number | null;
  veloRotOverride: number | null;
  heroTurnSpeedOverrideDeg: number | null;
}

interface CameraDebugContextValue {
  state: CameraDebugState;
  setBestRangeOverride: (value: number | null) => void;
  setBestElevationOverride: (value: number | null) => void;
  setBestAzimuthOverride: (value: number | null) => void;
  setRotOffsetXOverride: (value: number | null) => void;
  setRotOffsetYOverride: (value: number | null) => void;
  setVeloTransOverride: (value: number | null) => void;
  setVeloRotOverride: (value: number | null) => void;
  setHeroTurnSpeedOverrideDeg: (value: number | null) => void;
}

const CameraDebugContext = createContext<CameraDebugContextValue | null>(null);

export function CameraDebugProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<CameraDebugState>({
    bestRangeOverride: null,
    bestElevationOverride: null,
    bestAzimuthOverride: null,
    rotOffsetXOverride: null,
    rotOffsetYOverride: null,
    veloTransOverride: null,
    veloRotOverride: null,
    heroTurnSpeedOverrideDeg: null,
  });

  const setBestRangeOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, bestRangeOverride: value }));
  }, []);

  const setBestElevationOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, bestElevationOverride: value }));
  }, []);

  const setBestAzimuthOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, bestAzimuthOverride: value }));
  }, []);

  const setRotOffsetXOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, rotOffsetXOverride: value }));
  }, []);

  const setRotOffsetYOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, rotOffsetYOverride: value }));
  }, []);

  const setVeloTransOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, veloTransOverride: value }));
  }, []);

  const setVeloRotOverride = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, veloRotOverride: value }));
  }, []);

  const setHeroTurnSpeedOverrideDeg = useCallback((value: number | null) => {
    setState(prev => ({ ...prev, heroTurnSpeedOverrideDeg: value }));
  }, []);

  const value = useMemo(() => ({
    state,
    setBestRangeOverride,
    setBestElevationOverride,
    setBestAzimuthOverride,
    setRotOffsetXOverride,
    setRotOffsetYOverride,
    setVeloTransOverride,
    setVeloRotOverride,
    setHeroTurnSpeedOverrideDeg
  }), [
    state,
    setBestRangeOverride,
    setBestElevationOverride,
    setBestAzimuthOverride,
    setRotOffsetXOverride,
    setRotOffsetYOverride,
    setVeloTransOverride,
    setVeloRotOverride,
    setHeroTurnSpeedOverrideDeg
  ]);

  return (
    <CameraDebugContext.Provider value={value}>
      {children}
    </CameraDebugContext.Provider>
  );
}

export function useCameraDebug() {
  const context = useContext(CameraDebugContext);
  if (!context) {
    throw new Error('useCameraDebug must be used within CameraDebugProvider');
  }
  return context;
}
