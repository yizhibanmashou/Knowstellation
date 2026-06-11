import { create } from 'zustand';

interface GraphState {
  expandedNodeIds: Set<string>;
  highlightedIds: Set<string>;
  learnedByChapter: Record<string, Set<string>>;
  markExpanded: (id: string) => void;
  setHighlightedIds: (ids: Set<string>) => void;
  markLearned: (chapterId: string, formulaId: string) => void;
  resetGraph: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  expandedNodeIds: new Set(),
  highlightedIds: new Set(),
  learnedByChapter: {},
  markExpanded: (id) =>
    set((state) => {
      const expandedNodeIds = new Set(state.expandedNodeIds);
      expandedNodeIds.add(id);
      return { expandedNodeIds };
    }),
  setHighlightedIds: (highlightedIds) => set({ highlightedIds }),
  markLearned: (chapterId, formulaId) =>
    set((state) => {
      const learnedByChapter = { ...state.learnedByChapter };
      const learned = new Set(learnedByChapter[chapterId] || []);
      learned.add(formulaId);
      learnedByChapter[chapterId] = learned;
      return { learnedByChapter };
    }),
  resetGraph: () => set({ expandedNodeIds: new Set(), highlightedIds: new Set(), learnedByChapter: {} }),
}));
