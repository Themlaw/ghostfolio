import type { DecisionItem } from './report-response.interface';

export interface DecisionsResponse {
  decisions: (DecisionItem & {
    report: { id: string; subjects: string[]; title: string };
  })[];
}
