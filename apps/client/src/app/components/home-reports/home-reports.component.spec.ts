import { PushNotificationService } from '@ghostfolio/client/services/push-notification.service';
import { DataService } from '@ghostfolio/ui/services';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import '@angular/localize/init';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { GfHomeReportsComponent } from './home-reports.component';

jest.mock('@ionic/angular/standalone', () => {
  const { Component } = jest.requireActual('@angular/core');

  class IonIcon {}

  Component({ selector: 'ion-icon', template: '' })(IonIcon);

  return { IonIcon };
});

describe('GfHomeReportsComponent', () => {
  const report = (id: string, kind: string, publishedAt: string) => ({
    concepts: [],
    createdAt: publishedAt,
    decisions: [],
    id,
    kind,
    points: [
      { level: 'important', subject: 'A', text: 'a' },
      { level: 'info', subject: 'B', text: 'b' }
    ],
    publishedAt,
    sources: [],
    subjects: [],
    summary: `Summary ${id}`,
    title: `Title ${id}`
  });

  let dataService: { fetchDecisions: jest.Mock; fetchReports: jest.Mock };
  let fixture: ComponentFixture<GfHomeReportsComponent>;

  beforeEach(async () => {
    dataService = {
      fetchDecisions: jest.fn().mockReturnValue(
        of({
          decisions: [{ id: 'd1', question: 'Open a PEA?' }]
        })
      ),
      fetchReports: jest.fn().mockReturnValue(
        of({
          count: 2,
          reports: [
            report('1', 'BRIEF', '2026-11-20T17:44:00.000Z'),
            report('2', 'ANALYSIS', '2026-11-20T09:00:00.000Z')
          ]
        })
      )
    };

    await TestBed.configureTestingModule({
      imports: [GfHomeReportsComponent],
      providers: [
        provideRouter([]),
        { provide: DataService, useValue: dataService },
        {
          provide: PushNotificationService,
          useValue: {
            dismissBanner: jest.fn(),
            isBannerDismissed: signal(false),
            isBusy: signal(false),
            isDenied: signal(false),
            isSubscribed: signal(false),
            isSupported: true,
            subscribe: jest.fn()
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GfHomeReportsComponent);
    fixture.detectChanges();
  });

  it('lists the reports grouped by day with the pending decisions', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(dataService.fetchReports).toHaveBeenCalledWith(
      expect.objectContaining({ kind: undefined, skip: 0, take: 20 })
    );
    expect(text).toContain('Title 1');
    expect(text).toContain('Summary 1');
    expect(text).toContain('Title 2');
    expect(text).toContain('Open a PEA?');
    expect(text).toContain('1 important');
    expect(
      fixture.nativeElement.querySelectorAll('h2.group-title').length
    ).toBe(1);
  });

  it('invites to enable the notifications', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Enable notifications to receive important reports'
    );
  });

  it('filters by kind', () => {
    (fixture.componentInstance as any).onChangeKind('LESSON');

    expect(dataService.fetchReports).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'LESSON', skip: 0 })
    );
  });
});
