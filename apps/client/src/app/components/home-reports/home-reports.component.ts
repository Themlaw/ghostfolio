import { PushNotificationService } from '@ghostfolio/client/services/push-notification.service';
import { ReportResponse } from '@ghostfolio/common/interfaces';
import { internalRoutes } from '@ghostfolio/common/routes/routes';
import { DataService } from '@ghostfolio/ui/services';

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { format } from 'date-fns';
import { addIcons } from 'ionicons';
import {
  chevronForwardOutline,
  closeOutline,
  helpCircleOutline,
  newspaperOutline,
  notificationsOutline,
  schoolOutline,
  searchOutline,
  statsChartOutline
} from 'ionicons/icons';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { getReportKindIcon, getReportKindLabel } from './report-kind';

const PAGE_SIZE = 20;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    IonIcon,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RouterModule
  ],
  selector: 'gf-home-reports',
  styleUrls: ['./home-reports.component.scss'],
  templateUrl: './home-reports.component.html'
})
export class GfHomeReportsComponent implements OnInit {
  protected readonly internalRoutes = internalRoutes;
  protected readonly kinds: { kind: string; label: string }[] = [
    { kind: '', label: $localize`All` },
    { kind: 'BRIEF', label: $localize`Briefs` },
    { kind: 'ANALYSIS', label: $localize`Analyses` },
    { kind: 'LESSON', label: $localize`Lessons` }
  ];
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  protected readonly count = signal(0);
  protected readonly hasFailed = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly kind = signal('');
  protected readonly openDecisions = signal<{ id: string; question: string }[]>(
    []
  );
  protected readonly reports = signal<ReportResponse[]>([]);
  protected readonly subject = signal('');

  protected readonly canLoadMore = computed(() => {
    return this.reports().length < this.count();
  });

  protected readonly groups = computed(() => {
    const groups: { date: Date; key: string; reports: ReportResponse[] }[] = [];

    for (const report of this.reports()) {
      const date = new Date(report.publishedAt);
      const key = format(date, 'yyyy-MM-dd');
      const lastGroup = groups.at(-1);

      if (lastGroup?.key === key) {
        lastGroup.reports.push(report);
      } else {
        groups.push({ date, key, reports: [report] });
      }
    }

    return groups;
  });

  protected readonly shouldShowPushBanner = computed(() => {
    return (
      this.pushNotificationService.isSupported &&
      !this.pushNotificationService.isSubscribed() &&
      !this.pushNotificationService.isDenied() &&
      !this.pushNotificationService.isBannerDismissed()
    );
  });

  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly pushNotificationService = inject(PushNotificationService);

  public constructor() {
    addIcons({
      chevronForwardOutline,
      closeOutline,
      helpCircleOutline,
      newspaperOutline,
      notificationsOutline,
      schoolOutline,
      searchOutline,
      statsChartOutline
    });
  }

  public ngOnInit() {
    this.searchControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.load({ reset: true });
      });

    this.dataService
      .fetchDecisions({ status: 'OPEN' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ decisions }) => {
          this.openDecisions.set(
            decisions.map(({ id, question }) => ({ id, question }))
          );
        },
        error: () => {
          this.openDecisions.set([]);
        }
      });

    this.activatedRoute.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.subject.set(params.get('subject') ?? '');
        this.load({ reset: true });
      });
  }

  protected getIcon(report: ReportResponse) {
    return getReportKindIcon(report.kind);
  }

  protected getKindLabel(report: ReportResponse) {
    return getReportKindLabel(report.kind);
  }

  protected getLevelCount(report: ReportResponse, level: string) {
    return report.points.filter((point) => point.level === level).length;
  }

  protected onChangeKind(kind: string | undefined) {
    // A chip listbox gives undefined when the selected chip is clicked again
    this.kind.set(kind ?? '');
    this.load({ reset: true });
  }

  protected onClearSubject() {
    this.router.navigate([], { queryParams: { subject: null } });
  }

  protected onEnablePush() {
    this.pushNotificationService.subscribe();
  }

  protected onLoadMore() {
    this.load({ reset: false });
  }

  private load({ reset }: { reset: boolean }) {
    this.hasFailed.set(false);
    this.isLoading.set(true);

    this.dataService
      .fetchReports({
        kind: this.kind() || undefined,
        q: this.searchControl.value.trim() || undefined,
        subject: this.subject() || undefined,
        skip: reset ? 0 : this.reports().length,
        take: PAGE_SIZE
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ count, reports }) => {
          this.count.set(count);
          this.reports.set(reset ? reports : [...this.reports(), ...reports]);
          this.isLoading.set(false);
        },
        error: () => {
          this.hasFailed.set(true);
          this.isLoading.set(false);
        }
      });
  }
}
