import { internalRoutes, publicRoutes } from '@ghostfolio/common/routes/routes';

import {
  HttpClient,
  HttpErrorResponse,
  HttpParams
} from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';

interface ConsentDescription {
  clientName: string;
  readOnlyScopes: string[];
  redirectHost: string;
  scopes: string[];
}

type State = 'ERROR' | 'LOADING' | 'READY' | 'SIGNED_OUT' | 'SUBMITTING';

const PARAMETER_NAMES = [
  'client_id',
  'code_challenge',
  'code_challenge_method',
  'redirect_uri',
  'resource',
  'response_type',
  'scope',
  'state'
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'page' },
  imports: [MatButtonModule, MatCheckboxModule, MatProgressSpinnerModule],
  selector: 'gf-oauth-consent-page',
  styleUrls: ['./oauth-consent-page.scss'],
  templateUrl: './oauth-consent-page.html'
})
export class GfOauthConsentPageComponent implements OnInit {
  public description?: ConsentDescription;
  public isReadOnly = true;
  public state: State = 'LOADING';

  private parameters: Record<string, string> = {};

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private destroyRef: DestroyRef,
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  public get canWrite() {
    return (
      this.description &&
      this.description.scopes.length > this.description.readOnlyScopes.length
    );
  }

  public get grantedScopes() {
    return this.isReadOnly
      ? (this.description?.readOnlyScopes ?? [])
      : (this.description?.scopes ?? []);
  }

  public ngOnInit() {
    const queryParams = this.route.snapshot.queryParams;

    this.parameters = Object.fromEntries(
      PARAMETER_NAMES.filter((name) => {
        return typeof queryParams[name] === 'string';
      }).map((name) => {
        return [name, queryParams[name] as string];
      })
    );

    this.http
      .get<ConsentDescription>('/api/v1/oauth/authorize/consent', {
        params: new HttpParams({ fromObject: this.parameters })
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (error: HttpErrorResponse) => {
          this.state = error.status === 401 ? 'SIGNED_OUT' : 'ERROR';
          this.changeDetectorRef.markForCheck();
        },
        next: (description) => {
          this.description = description;
          this.state = 'READY';
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  public onApprove() {
    this.submit(true);
  }

  public onDeny() {
    this.submit(false);
  }

  public onGoToHome() {
    this.router.navigate(internalRoutes.home.routerLink);
  }

  public onSignIn() {
    this.router.navigate(publicRoutes.start.routerLink);
  }

  private submit(approve: boolean) {
    this.state = 'SUBMITTING';

    this.http
      .post<{ redirectUrl: string }>('/api/v1/oauth/authorize/consent', {
        ...this.parameters,
        approve,
        readOnly: this.isReadOnly
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.state = 'ERROR';
          this.changeDetectorRef.markForCheck();
        },
        next: ({ redirectUrl }) => {
          // The client of the MCP continues the flow, hence leave the page
          window.location.assign(redirectUrl);
        }
      });
  }
}
