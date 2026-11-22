import { DecisionItem, DecisionsResponse } from '@ghostfolio/common/interfaces';
import { internalRoutes } from '@ghostfolio/common/routes/routes';
import { DataService } from '@ghostfolio/ui/services';

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
import { MatButtonModule } from '@angular/material/button';
import { RouterModule } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { subDays } from 'date-fns';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { forkJoin } from 'rxjs';

import { GfDecisionCardComponent } from '../decision-card/decision-card.component';

type DecisionWithReport = DecisionsResponse['decisions'][number];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GfDecisionCardComponent, IonIcon, MatButtonModule, RouterModule],
  selector: 'gf-home-decisions',
  styleUrls: ['./home-decisions.component.scss'],
  templateUrl: './home-decisions.component.html'
})
export class GfHomeDecisionsComponent implements OnInit {
  protected readonly hasFailed = signal(false);
  protected readonly internalRoutes = internalRoutes;
  protected readonly isLoading = signal(true);

  protected readonly decided = signal<DecisionWithReport[]>([]);
  protected readonly open = signal<DecisionWithReport[]>([]);

  protected readonly openCount = computed(() => this.open().length);

  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);

  public constructor() {
    addIcons({ arrowBackOutline });
  }

  public ngOnInit() {
    forkJoin({
      decided: this.dataService.fetchDecisions({
        since: subDays(new Date(), 30).toISOString(),
        status: 'DECIDED'
      }),
      open: this.dataService.fetchDecisions({ status: 'OPEN' })
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ decided, open }) => {
          this.decided.set(decided.decisions);
          this.open.set(open.decisions);
          this.isLoading.set(false);
        },
        error: () => {
          this.hasFailed.set(true);
          this.isLoading.set(false);
        }
      });
  }

  protected onAnsweredOpen(
    answered: DecisionItem,
    previous: DecisionWithReport
  ) {
    const updated = { ...previous, ...answered };

    this.open.set(this.open().filter(({ id }) => id !== updated.id));

    if (updated.status === 'DECIDED') {
      this.decided.set([
        updated,
        ...this.decided().filter(({ id }) => id !== updated.id)
      ]);
    }
  }

  protected onAnsweredDecided(
    answered: DecisionItem,
    previous: DecisionWithReport
  ) {
    const updated = { ...previous, ...answered };

    if (updated.status === 'DECIDED') {
      this.decided.set(
        this.decided().map((item) => (item.id === updated.id ? updated : item))
      );
    } else {
      this.decided.set(this.decided().filter(({ id }) => id !== updated.id));

      if (updated.status === 'OPEN') {
        this.open.set([updated, ...this.open()]);
      }
    }
  }
}
