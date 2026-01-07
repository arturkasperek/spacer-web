import { createContext, useContext, useRef, useMemo, ReactNode } from 'react';

interface PlayerInputState {
  heroMouseYawDeltaDeg: number;
}

interface PlayerInputContextValue {
  addMouseYawDelta: (deltaDeg: number) => void;
  consumeMouseYawDelta: () => number;
}

const PlayerInputContext = createContext<PlayerInputContextValue | null>(null);

export function PlayerInputProvider({ children }: { readonly children: ReactNode }) {
  const stateRef = useRef<PlayerInputState>({
    heroMouseYawDeltaDeg: 0,
  });

  const value = useMemo(() => ({
    addMouseYawDelta: (deltaDeg: number) => {
      stateRef.current.heroMouseYawDeltaDeg += deltaDeg;
    },
    consumeMouseYawDelta: (): number => {
      const value = stateRef.current.heroMouseYawDeltaDeg;
      stateRef.current.heroMouseYawDeltaDeg = 0;
      return value;
    }
  }), []);

  return (
    <PlayerInputContext.Provider value={value}>
      {children}
    </PlayerInputContext.Provider>
  );
}

export function usePlayerInput() {
  const context = useContext(PlayerInputContext);
  if (!context) {
    throw new Error('usePlayerInput must be used within PlayerInputProvider');
  }
  return context;
}

