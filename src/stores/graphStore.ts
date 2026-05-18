import { create } from 'zustand';

interface GraphState {
  expandedNodeIds: Set<string>;
  highlightedIds: Set<string>;
  markExpanded: (id: string) => void;
  setHighlightedIds: (ids: Set<string>) => void;
  resetGraph: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  expandedNodeIds: new Set(),
  highlightedIds: new Set(),
  markExpanded: (id) =>
    set((state) => {
      const expandedNodeIds = new Set(state.expandedNodeIds);
      expandedNodeIds.add(id);
      return { expandedNodeIds };
    }),
  setHighlightedIds: (highlightedIds) => set({ highlightedIds }),
  resetGraph: () => set({ expandedNodeIds: new Set(), highlightedIds: new Set() }),
}));
