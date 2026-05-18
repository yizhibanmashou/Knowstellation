import { create } from 'zustand';

interface StarFieldState {
  asleep: boolean;
  setAsleep: (asleep: boolean) => void;
}

export const useStarFieldStore = create<StarFieldState>((set) => ({
  asleep: false,
  setAsleep: (asleep) => set({ asleep }),
}));
