export type LanguageCode = 'en' | 'zh';
export type Difficulty = 'introductory' | 'intermediate' | 'advanced';
export type ChapterLayer = 'backbone' | 'full';

export interface ChapterNavigatorPayload {
  groups: ChapterGroup[];
}

export interface ChapterGroup {
  id: string;
  title_en: string;
  title_zh: string;
  description_en?: string;
  description_zh?: string;
  chapters: ChapterLearningEntry[];
}

export interface ChapterLearningEntry {
  chapter: number;
  chapter_id: string;
  title_en: string;
  title_zh: string;
  description_en: string;
  description_zh: string;
  section_hint?: string;
  backbone_formula_ids: string[];
  full_formula_ids: string[];
  representative_formula_ids: string[];
  difficulty: Difficulty;
}

export interface ThemeRoutesPayload {
  paths: ThemeRoute[];
}

export interface ThemeRoute {
  id: string;
  title_en: string;
  title_zh: string;
  description_en: string;
  description_zh: string;
  formula_ids: string[];
  step_notes: ThemeRouteStepNote[];
  tags: string[];
  difficulty: Difficulty;
  coverage: {
    chapter_count: number;
    formula_count: number;
  };
}

export interface ThemeRouteStepNote {
  formula_id: string;
  note_en: string;
  note_zh: string;
}

export type StudyContext =
  | { type: 'free' }
  | { type: 'chapter'; chapter: ChapterLearningEntry; layer: ChapterLayer }
  | { type: 'theme'; route: ThemeRoute };
