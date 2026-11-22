import {
  KEY_STAY_SIGNED_IN,
  SettingsStorageService
} from '@ghostfolio/client/services/settings-storage.service';
import { TokenStorageService } from '@ghostfolio/client/services/token-storage.service';
import { OAuthResponse } from '@ghostfolio/common/interfaces';

import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-auth-page',
  styleUrls: ['./auth-page.scss'],
  templateUrl: './auth-page.html'
})
export class GfAuthPageComponent implements OnInit {
  public constructor(
    private destroyRef: DestroyRef,
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
    private settingsStorageService: SettingsStorageService,
    private tokenStorageService: TokenStorageService
  ) {}

  public ngOnInit() {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const code = this.route.snapshot.queryParams['code'];
        const jwt = params['jwt'];

        if (code) {
          // OIDC: exchange the single-use code for the JWT
          this.http
            .post<OAuthResponse>('/api/auth/oidc/exchange', { code })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              error: () => {
                this.router.navigate(['/']);
              },
              next: ({ authToken }) => {
                this.saveTokenAndNavigate(authToken);
              }
            });
        } else if (jwt) {
          this.saveTokenAndNavigate(jwt);
        } else {
          this.router.navigate(['/']);
        }
      });
  }

  private saveTokenAndNavigate(jwt: string) {
    this.tokenStorageService.saveToken(
      jwt,
      this.settingsStorageService.getSetting(KEY_STAY_SIGNED_IN) === 'true'
    );

    this.router.navigate(['/']);
  }
}
