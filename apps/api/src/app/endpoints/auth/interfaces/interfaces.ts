import { AuthDeviceDto } from '@ghostfolio/common/dtos';

import { Provider } from '@prisma/client';

export interface AuthDeviceDialogParams {
  authDevice: AuthDeviceDto;
}

export interface OidcFlow {
  codeVerifier: string;
  nonce: string;
  state: string;
}

export interface ValidateOAuthLoginParams {
  /** Former identifier (subject only) of an account, which gets migrated */
  legacyThirdPartyId?: string;
  provider: Provider;
  thirdPartyId: string;
}
