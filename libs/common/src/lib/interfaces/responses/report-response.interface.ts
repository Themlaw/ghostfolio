import type { DecisionStatus, ReportKind } from '@ghostfolio/prisma/enums';

export type ReportPointLevel = 'important' | 'info' | 'note';

export interface ReportPoint {
  forYou?: string;
  level: ReportPointLevel;
  subject: string;
  text: string;
}

export interface ReportConcept {
  definition: string;
  example: string;
  forYou?: string;
  name: string;
  theme?: string;
}

export interface ReportSource {
  date?: string;
  title: string;
  url: string;
}

export interface DecisionOption {
  id: string;
  label: string;
}

export interface DecisionItem {
  answerOptionId?: string | null;
  answerText?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  id: string;
  options: DecisionOption[];
  question: string;
  reportId: string;
  status: DecisionStatus;
}

export interface ReportResponse {
  concepts: ReportConcept[];
  createdAt: string;
  decisions: DecisionItem[];
  details?: string | null;
  id: string;
  kind: ReportKind;
  points: ReportPoint[];
  publishedAt: string;
  sources: ReportSource[];
  subjects: string[];
  summary: string;
  title: string;
}

export interface ReportsResponse {
  count: number;
  reports: ReportResponse[];
}
