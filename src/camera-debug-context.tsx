import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';

interface CameraDebugState {
  bestRangeOverride: number | null;
  bestElevationOverride: number | null;
  bestAzimuthOverride: number | null;
  rotOffsetXOverride: number | null;
  rotOffsetYOverride: number | null;
}

interface CameraDebugContextValue {
  state: CameraDebugState;
  setBestRangeOverride: (value: number | null) => void;
  setBestElevationOverride: (value: number | null) => void;
  setBestAzimuthOverride: (value: number | null) => void;
  setRotOffsetXOverride: (value: number | null) => void;
  setRotOffsetYOverride: (value: number | null) => void;
}

const CameraDebugContext = createContext<CameraDebugContextValue | null>(null);

export function CameraDebugProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<CameraDebugState>({
    bestRangeOverride: null,
    bestElevationOverride: null,
    bestAzimuthOverride: null,
    rotOffsetXOverride: null,
    rotOffsetYOverride: null,
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

  const value = useMemo(() => ({
    state,
    setBestRangeOverride,
    setBestElevationOverride,
    setBestAzimuthOverride,
    setRotOffsetXOverride,
    setRotOffsetYOverride
  }), [
    state,
    setBestRangeOverride,
    setBestElevationOverride,
    setBestAzimuthOverride,
    setRotOffsetXOverride,
    setRotOffsetYOverride
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
