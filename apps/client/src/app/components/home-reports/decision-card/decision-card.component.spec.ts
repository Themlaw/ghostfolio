import { DecisionItem } from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import '@angular/localize/init';
import { of } from 'rxjs';

import { GfDecisionCardComponent } from './decision-card.component';

describe('GfDecisionCardComponent', () => {
  const openDecision: DecisionItem = {
    createdAt: '2026-11-20T10:00:00.000Z',
    id: 'decision-id',
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' }
    ],
    question: 'Open a PEA?',
    reportId: 'report-id',
    status: 'OPEN'
  };

  let dataService: { patchDecision: jest.Mock; postDecisionAnswer: jest.Mock };
  let fixture: ComponentFixture<GfDecisionCardComponent>;

  function setup(decision: DecisionItem) {
    fixture = TestBed.createComponent(GfDecisionCardComponent);
    fixture.componentRef.setInput('decision', decision);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    dataService = {
      patchDecision: jest.fn(),
      postDecisionAnswer: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [GfDecisionCardComponent],
      providers: [{ provide: DataService, useValue: dataService }]
    }).compileComponents();
  });

  it('disables the confirmation until an option is chosen', () => {
    const element = setup(openDecision);
    const button = element.querySelector<HTMLButtonElement>(
      'button[mat-flat-button]'
    );

    expect(element.textContent).toContain('Open a PEA?');
    expect(button.disabled).toBe(true);
  });

  it('sends the chosen option and the text', () => {
    const answered: DecisionItem = {
      ...openDecision,
      answerOptionId: 'yes',
      answerText: 'If free',
      decidedAt: '2026-11-21T10:00:00.000Z',
      status: 'DECIDED'
    };

    dataService.postDecisionAnswer.mockReturnValue(of(answered));

    setup(openDecision);

    const emitted = jest.fn();

    fixture.componentInstance.answered.subscribe(emitted);

    const component = fixture.componentInstance as any;

    component.selectedOptionId.set('yes');
    component.text.set(' If free ');
    component.onSubmit();
    fixture.detectChanges();

    expect(dataService.postDecisionAnswer).toHaveBeenCalledWith({
      id: 'decision-id',
      optionId: 'yes',
      text: 'If free'
    });
    expect(emitted).toHaveBeenCalledWith(answered);
    expect(component.isEditing()).toBe(false);
  });

  it('shows the answer of a decided decision and allows to edit it', () => {
    const element = setup({
      ...openDecision,
      answerOptionId: 'yes',
      answerText: 'If free',
      decidedAt: '2026-11-21T10:00:00.000Z',
      status: 'DECIDED'
    });

    expect(element.textContent).toContain('Yes · If free');
    expect(element.querySelector('mat-button-toggle-group')).toBeNull();

    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Edit'))
      .click();
    fixture.detectChanges();

    expect(element.querySelector('mat-button-toggle-group')).not.toBeNull();
  });
});
