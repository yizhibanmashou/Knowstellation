import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LearningPath } from '../types/path';

export function useLearningPath(paths: LearningPath[]) {
  const [searchParams] = useSearchParams();
  const pathId = searchParams.get('path');
  return useMemo(() => paths.find((path) => path.id === pathId) || null, [pathId, paths]);
}
