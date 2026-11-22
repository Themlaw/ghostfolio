import { ReportResponse } from '@ghostfolio/common/interfaces';
import { DecisionItem } from '@ghostfolio/common/interfaces';
import { internalRoutes } from '@ghostfolio/common/routes/routes';
import { DataService } from '@ghostfolio/ui/services';

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  chevronBackOutline,
  chevronForwardOutline,
  documentTextOutline,
  newspaperOutline,
  schoolOutline,
  statsChartOutline
} from 'ionicons/icons';
import { MarkdownModule } from 'ngx-markdown';
import { map, switchMap } from 'rxjs';

import { GfDecisionCardComponent } from '../decision-card/decision-card.component';
import { getReportKindIcon, getReportKindLabel } from '../report-kind';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    GfDecisionCardComponent,
    IonIcon,
    MarkdownModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    RouterModule
  ],
  selector: 'gf-home-report-detail',
  styleUrls: ['./home-report-detail.component.scss'],
  templateUrl: './home-report-detail.component.html'
})
export class GfHomeReportDetailComponent {
  protected readonly hasFailed = signal(false);
  protected readonly internalRoutes = internalRoutes;
  protected readonly isLoading = signal(true);
  protected readonly newer = signal<ReportResponse | undefined>(undefined);
  protected readonly older = signal<ReportResponse | undefined>(undefined);
  protected readonly report = signal<ReportResponse | undefined>(undefined);

  protected readonly decisions = signal<DecisionItem[]>([]);

  protected readonly icon = computed(() => {
    const report = this.report();

    return report ? getReportKindIcon(report.kind) : 'newspaper-outline';
  });

  protected readonly kindLabel = computed(() => {
    const report = this.report();

    return report ? getReportKindLabel(report.kind) : '';
  });

  protected readonly levels = [
    { level: 'important', label: $localize`Important` },
    { level: 'note', label: $localize`Worth noting` },
    { level: 'info', label: $localize`For your information` }
  ];

  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);

  public constructor() {
    addIcons({
      arrowBackOutline,
      chevronBackOutline,
      chevronForwardOutline,
      documentTextOutline,
      newspaperOutline,
      schoolOutline,
      statsChartOutline
    });

    this.activatedRoute.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        switchMap((id) => {
          this.hasFailed.set(false);
          this.isLoading.set(true);
          this.newer.set(undefined);
          this.older.set(undefined);

          return this.dataService.fetchReport(id);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.decisions.set(report.decisions ?? []);
          this.isLoading.set(false);

          this.loadNeighbors(report);
        },
        error: () => {
          this.hasFailed.set(true);
          this.isLoading.set(false);
        }
      });
  }

  protected getLevelLabel(level: string) {
    return this.levels.find((item) => item.level === level)?.label ?? level;
  }

  protected onAnswered(answered: DecisionItem) {
    this.decisions.set(
      this.decisions().map((decision) => {
        return decision.id === answered.id ? answered : decision;
      })
    );
  }

  private loadNeighbors({ id }: ReportResponse) {
    // The reports are sorted from the newest to the oldest
    this.dataService
      .fetchReports({ take: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ reports }) => {
          const index = reports.findIndex((report) => report.id === id);

          if (index >= 0) {
            this.newer.set(reports[index - 1]);
            this.older.set(reports[index + 1]);
          }
        },
        error: () => {
          this.newer.set(undefined);
          this.older.set(undefined);
        }
      });
  }
}
