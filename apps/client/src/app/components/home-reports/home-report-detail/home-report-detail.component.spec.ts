import { DataService } from '@ghostfolio/ui/services';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import '@angular/localize/init';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter
} from '@angular/router';
import { provideMarkdown } from 'ngx-markdown';
import { of } from 'rxjs';

import { GfHomeReportDetailComponent } from './home-report-detail.component';

jest.mock('@ionic/angular/standalone', () => {
  const { Component } = jest.requireActual('@angular/core');

  class IonIcon {}

  Component({ selector: 'ion-icon', template: '' })(IonIcon);

  return { IonIcon };
});

jest.mock('ngx-markdown', () => {
  const { Component, Input, NgModule } = jest.requireActual('@angular/core');

  class MarkdownComponent {
    public data: string;
  }

  Component({ selector: 'markdown', template: '{{ data }}' })(
    MarkdownComponent
  );
  Input()(MarkdownComponent.prototype, 'data');

  class MarkdownModule {}

  NgModule({ exports: [MarkdownComponent], imports: [MarkdownComponent] })(
    MarkdownModule
  );

  return { MarkdownModule, provideMarkdown: () => [] };
});

describe('GfHomeReportDetailComponent', () => {
  const base = {
    concepts: [],
    createdAt: '2026-11-20T17:44:00.000Z',
    decisions: [],
    kind: 'BRIEF',
    points: [],
    publishedAt: '2026-11-20T17:44:00.000Z',
    sources: [],
    subjects: [],
    summary: 'Summary',
    title: 'Title'
  };

  let fixture: ComponentFixture<GfHomeReportDetailComponent>;

  beforeEach(async () => {
    const dataService = {
      fetchReport: jest.fn().mockReturnValue(
        of({
          ...base,
          decisions: [
            {
              createdAt: base.createdAt,
              id: 'd1',
              options: [{ id: 'yes', label: 'Yes' }],
              question: 'Open a PEA?',
              reportId: 'current',
              status: 'OPEN'
            }
          ],
          id: 'current',
          points: [
            { level: 'important', subject: 'Anthropic is back', text: 'x' }
          ],
          sources: [{ title: 'Source 1', url: 'https://example.com/source' }],
          subjects: ['Anthropic']
        })
      ),
      fetchReports: jest.fn().mockReturnValue(
        of({
          count: 3,
          reports: [
            { ...base, id: 'newer', title: 'Newer report' },
            { ...base, id: 'current', title: 'Title' },
            { ...base, id: 'older', title: 'Older report' }
          ]
        })
      )
    };

    await TestBed.configureTestingModule({
      imports: [GfHomeReportDetailComponent],
      providers: [
        provideMarkdown(),
        provideRouter([]),
        { provide: DataService, useValue: dataService },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'current' }))
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GfHomeReportDetailComponent);
    fixture.detectChanges();
  });

  it('shows the report with its points, decision, sources and neighbors', () => {
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent;

    expect(text).toContain('Summary');
    expect(text).toContain('Anthropic is back');
    expect(text).toContain('Important');
    expect(text).toContain('Open a PEA?');
    expect(text).toContain('Source 1');
    expect(text).toContain('Anthropic');
    expect(text).toContain('Newer report');
    expect(text).toContain('Older report');
    expect(
      element
        .querySelector('a[href="https://example.com/source"]')
        ?.getAttribute('rel')
    ).toContain('noopener');
  });
});
