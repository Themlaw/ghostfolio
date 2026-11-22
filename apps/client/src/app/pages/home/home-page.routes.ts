import { GfHomeHoldingsComponent } from '@ghostfolio/client/components/home-holdings/home-holdings.component';
import { GfHomeOverviewComponent } from '@ghostfolio/client/components/home-overview/home-overview.component';
import { GfHomeDecisionsComponent } from '@ghostfolio/client/components/home-reports/home-decisions/home-decisions.component';
import { GfHomeReportDetailComponent } from '@ghostfolio/client/components/home-reports/home-report-detail/home-report-detail.component';
import { GfHomeReportsComponent } from '@ghostfolio/client/components/home-reports/home-reports.component';
import { GfHomeSummaryComponent } from '@ghostfolio/client/components/home-summary/home-summary.component';
import { GfHomeWatchlistComponent } from '@ghostfolio/client/components/home-watchlist/home-watchlist.component';
import { GfWatchlistDialogHostComponent } from '@ghostfolio/client/components/home-watchlist/watchlist-dialog-host/watchlist-dialog-host.component';
import { GfMarketsComponent } from '@ghostfolio/client/components/markets/markets.component';
import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { GfHomePageComponent } from './home-page.component';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        component: GfHomeOverviewComponent
      },
      {
        path: internalRoutes.home.subRoutes.holdings.path,
        component: GfHomeHoldingsComponent,
        title: internalRoutes.home.subRoutes.holdings.title
      },
      {
        path: internalRoutes.home.subRoutes.reports.path,
        children: [
          {
            path: '',
            component: GfHomeReportsComponent
          },
          {
            path: internalRoutes.home.subRoutes.reports.subRoutes.decisions
              .path,
            component: GfHomeDecisionsComponent,
            title:
              internalRoutes.home.subRoutes.reports.subRoutes.decisions.title
          },
          {
            path: ':id',
            component: GfHomeReportDetailComponent
          }
        ],
        title: internalRoutes.home.subRoutes.reports.title
      },
      {
        path: internalRoutes.home.subRoutes.summary.path,
        component: GfHomeSummaryComponent,
        title: internalRoutes.home.subRoutes.summary.title
      },
      {
        path: internalRoutes.home.subRoutes.markets.path,
        component: GfMarketsComponent,
        title: internalRoutes.home.subRoutes.markets.title
      },
      {
        children: [
          {
            component: GfWatchlistDialogHostComponent,
            path: internalRoutes.home.subRoutes.watchlist.subRoutes.create.path,
            title:
              internalRoutes.home.subRoutes.watchlist.subRoutes.create.title
          }
        ],
        path: internalRoutes.home.subRoutes.watchlist.path,
        component: GfHomeWatchlistComponent,
        title: internalRoutes.home.subRoutes.watchlist.title
      }
    ],
    component: GfHomePageComponent,
    path: '',
    title: internalRoutes.home.title
  }
];
