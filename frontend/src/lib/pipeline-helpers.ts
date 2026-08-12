import type { Project, PipelineStage, UseClass } from '../types';
import { PIPELINE_STAGES } from '../types';

export interface PipelineFilters {
  stage: PipelineStage | 'all';
  useClass: UseClass | 'all';
}

export type SortField = 'created_at' | 'price_pence' | 'stage';
export type SortDirection = 'asc' | 'desc';

const STAGE_ORDER = new Map(PIPELINE_STAGES.map((s, i) => [s.value, i]));

export function filterProjects(projects: Project[], filters: PipelineFilters): Project[] {
  return projects.filter((p) => {
    if (filters.stage !== 'all' && p.stage !== filters.stage) return false;
    if (filters.useClass !== 'all' && p.use_class !== filters.useClass) return false;
    return true;
  });
}

export function sortProjects(projects: Project[], sortBy: SortField, sortDir: SortDirection): Project[] {
  const sorted = [...projects];
  const dir = sortDir === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'created_at':
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'price_pence':
        return dir * (a.price_pence - b.price_pence);
      case 'stage':
        return dir * ((STAGE_ORDER.get(a.stage) ?? 0) - (STAGE_ORDER.get(b.stage) ?? 0));
      default:
        return 0;
    }
  });

  return sorted;
}
