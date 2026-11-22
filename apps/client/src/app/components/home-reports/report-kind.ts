import type { ReportKind } from '@ghostfolio/prisma/enums';

export function getReportKindIcon(kind: ReportKind) {
  switch (kind) {
    case 'BRIEF':
      return 'newspaper-outline';
    case 'LESSON':
      return 'school-outline';
    default:
      return 'stats-chart-outline';
  }
}

export function getReportKindLabel(kind: ReportKind) {
  switch (kind) {
    case 'ALLOCATION':
      return $localize`Allocation`;
    case 'ANALYSIS':
      return $localize`Analysis`;
    case 'BRIEF':
      return $localize`Brief`;
    case 'LESSON':
      return $localize`Lesson`;
    case 'REVIEW':
      return $localize`Review`;
    default:
      return kind;
  }
}
