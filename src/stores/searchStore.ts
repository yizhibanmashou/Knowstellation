import { create } from 'zustand';
import type { SearchFormula } from '../types/formula';

interface SearchState {
  query: string;
  results: SearchFormula[];
  selectedIndex: number;
  setQuery: (query: string) => void;
  setResults: (results: SearchFormula[]) => void;
  setSelectedIndex: (index: number) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  selectedIndex: 0,
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, selectedIndex: 0 }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  reset: () => set({ query: '', results: [], selectedIndex: 0 }),
}));
