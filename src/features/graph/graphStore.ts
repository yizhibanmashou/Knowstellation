import { create } from 'zustand';

export interface ConceptGraphViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export interface ConceptViewSnapshot {
  chapterId: string;
  formulaId: string;
  conceptId: string;
  revealedGroups: {
    prerequisites?: boolean;
    introduced?: boolean;
  };
  expandedReferenceKeys: string[];
  evidenceOpen: boolean;
  viewport?: ConceptGraphViewportSnapshot;
}

interface GraphState {
  expandedNodeIds: Set<string>;
  highlightedIds: Set<string>;
  learnedByChapter: Record<string, Set<string>>;
  learnedConceptsByChapter: Record<string, Set<string>>;
  conceptSnapshots: Record<string, ConceptViewSnapshot>;
  markExpanded: (id: string) => void;
  setHighlightedIds: (ids: Set<string>) => void;
  markLearned: (chapterId: string, formulaId: string) => void;
  markConceptLearned: (chapterId: string, conceptId: string) => void;
  saveConceptSnapshot: (key: string, snapshot: ConceptViewSnapshot) => void;
  getConceptSnapshot: (key: string) => ConceptViewSnapshot | undefined;
  resetGraph: () => void;
}

const SESSION_FORMULA_LEARNING_KEY = 'knowstellation:learned-formulas';
const SESSION_CONCEPT_LEARNING_KEY = 'knowstellation:learned-concepts';

function readSessionLearning(key: string): Record<string, Set<string>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return Object.fromEntries(Object.entries(parsed).map(([chapterId, items]) => [chapterId, new Set(items)]));
  } catch {
    return {};
  }
}

function writeSessionLearning(key: string, value: Record<string, Set<string>>) {
  if (typeof window === 'undefined') return;
  const serializable = Object.fromEntries(Object.entries(value).map(([chapterId, items]) => [chapterId, [...items]]));
  window.sessionStorage.setItem(key, JSON.stringify(serializable));
}

export const useGraphStore = create<GraphState>((set, get) => ({
  expandedNodeIds: new Set(),
  highlightedIds: new Set(),
  learnedByChapter: readSessionLearning(SESSION_FORMULA_LEARNING_KEY),
  learnedConceptsByChapter: readSessionLearning(SESSION_CONCEPT_LEARNING_KEY),
  conceptSnapshots: {},
  markExpanded: (id) =>
    set((state) => {
      const expandedNodeIds = new Set(state.expandedNodeIds);
      expandedNodeIds.add(id);
      return { expandedNodeIds };
    }),
  setHighlightedIds: (highlightedIds) => set({ highlightedIds }),
  markLearned: (chapterId, formulaId) =>
    set((state) => {
      if (!chapterId || !formulaId) return state;
      const learnedByChapter = { ...state.learnedByChapter };
      const learned = new Set(learnedByChapter[chapterId] || []);
      learned.add(formulaId);
      learnedByChapter[chapterId] = learned;
      writeSessionLearning(SESSION_FORMULA_LEARNING_KEY, learnedByChapter);
      return { learnedByChapter };
    }),
  markConceptLearned: (chapterId, conceptId) =>
    set((state) => {
      if (!chapterId || !conceptId) return state;
      const learnedConceptsByChapter = { ...state.learnedConceptsByChapter };
      const learned = new Set(learnedConceptsByChapter[chapterId] || []);
      learned.add(conceptId);
      learnedConceptsByChapter[chapterId] = learned;
      writeSessionLearning(SESSION_CONCEPT_LEARNING_KEY, learnedConceptsByChapter);
      return { learnedConceptsByChapter };
    }),
  saveConceptSnapshot: (key, snapshot) =>
    set((state) => ({
      conceptSnapshots: {
        ...state.conceptSnapshots,
        [key]: snapshot,
      },
    })),
  getConceptSnapshot: (key) => get().conceptSnapshots[key],
  resetGraph: () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(SESSION_FORMULA_LEARNING_KEY);
      window.sessionStorage.removeItem(SESSION_CONCEPT_LEARNING_KEY);
    }
    set({ expandedNodeIds: new Set(), highlightedIds: new Set(), learnedByChapter: {}, learnedConceptsByChapter: {}, conceptSnapshots: {} });
  },
}));
