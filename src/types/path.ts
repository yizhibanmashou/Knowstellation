export interface LearningPath {
  id: string;
  title: string;
  description: string;
  formula_ids: string[];
}

export interface LearningPathsPayload {
  paths: LearningPath[];
}
