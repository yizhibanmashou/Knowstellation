import { create } from 'zustand';

interface PathState {
  currentPathId: string | null;
  setCurrentPathId: (pathId: string | null) => void;
}

export const usePathStore = create<PathState>((set) => ({
  currentPathId: null,
  setCurrentPathId: (currentPathId) => set({ currentPathId }),
}));
