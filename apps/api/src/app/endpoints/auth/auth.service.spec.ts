import { AuthService } from './auth.service';

jest.mock(
  '@ghostfolio/api/services/configuration/configuration.service',
  () => ({
    ConfigurationService: class {}
  })
);
jest.mock('@ghostfolio/api/services/property/property.service', () => ({
  PropertyService: class {}
}));
jest.mock('@ghostfolio/api/services/user/user.service', () => ({
  UserService: class {}
}));

describe('AuthService', () => {
  const user = { id: 'user-id' };

  let userService: {
    createUser: jest.Mock;
    updateUser: jest.Mock;
    users: jest.Mock;
  };
  let isUserSignupEnabled: jest.Mock;
  let authService: AuthService;

  beforeEach(() => {
    userService = {
      createUser: jest.fn().mockResolvedValue(user),
      updateUser: jest.fn().mockResolvedValue(user),
      users: jest.fn().mockResolvedValue([])
    };
    isUserSignupEnabled = jest.fn().mockResolvedValue(true);

    authService = new AuthService(
      {} as never,
      { sign: (payload: { id: string }) => `jwt-${payload.id}` } as never,
      { isUserSignupEnabled } as never,
      userService as never
    );
  });

  it('migrates an account linked by the subject only', async () => {
    userService.users
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'legacy-id' }]);
    userService.updateUser.mockResolvedValue({ id: 'legacy-id' });

    await expect(
      authService.validateOAuthLogin({
        legacyThirdPartyId: 'sub',
        provider: 'OIDC',
        thirdPartyId: 'https://idp|sub'
      })
    ).resolves.toBe('jwt-legacy-id');

    expect(userService.updateUser).toHaveBeenCalledWith({
      data: { thirdPartyId: 'https://idp|sub' },
      where: { id: 'legacy-id' }
    });
    expect(userService.createUser).not.toHaveBeenCalled();
  });

  it('creates a user if signup is enabled', async () => {
    await authService.validateOAuthLogin({
      legacyThirdPartyId: 'sub',
      provider: 'OIDC',
      thirdPartyId: 'https://idp|sub'
    });

    expect(userService.createUser).toHaveBeenCalled();
  });
});
