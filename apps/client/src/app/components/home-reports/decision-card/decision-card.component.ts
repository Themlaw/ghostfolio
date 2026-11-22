import { DecisionItem } from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule
  ],
  selector: 'gf-decision-card',
  styleUrls: ['./decision-card.component.scss'],
  templateUrl: './decision-card.component.html'
})
export class GfDecisionCardComponent {
  public readonly decision = input.required<DecisionItem>();
  public readonly label = input<string>();

  public readonly answered = output<DecisionItem>();

  protected readonly hasFailed = signal(false);
  protected readonly isSaving = signal(false);

  protected readonly isEditing = linkedSignal(
    () => this.decision().status === 'OPEN'
  );
  protected readonly selectedOptionId = linkedSignal<string | null>(
    () => this.decision().answerOptionId ?? null
  );
  protected readonly text = linkedSignal(
    () => this.decision().answerText ?? ''
  );

  protected readonly answerLabel = computed(() => {
    const { answerOptionId, answerText, options } = this.decision();

    const optionLabel = options.find(({ id }) => {
      return id === answerOptionId;
    })?.label;

    return [optionLabel, answerText].filter(Boolean).join(' · ');
  });

  protected readonly canSubmit = computed(() => {
    return !!this.selectedOptionId() || !!this.text().trim();
  });

  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);

  protected onChangeText(event: Event) {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected onEdit() {
    this.isEditing.set(true);
  }

  protected onReopen() {
    this.dataService
      .patchDecision({ id: this.decision().id, status: 'OPEN' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (decision) => {
          this.answered.emit(decision);
        },
        error: () => {
          this.hasFailed.set(true);
        }
      });
  }

  protected onSubmit() {
    if (!this.canSubmit() || this.isSaving()) {
      return;
    }

    this.hasFailed.set(false);
    this.isSaving.set(true);

    this.dataService
      .postDecisionAnswer({
        id: this.decision().id,
        optionId: this.selectedOptionId() ?? undefined,
        text: this.text().trim() || undefined
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (decision) => {
          this.isSaving.set(false);
          this.isEditing.set(false);
          this.answered.emit(decision);
        },
        error: () => {
          this.hasFailed.set(true);
          this.isSaving.set(false);
        }
      });
  }
}
