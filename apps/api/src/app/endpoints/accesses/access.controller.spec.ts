import { hashMcpToken } from '@ghostfolio/api/helper/mcp-token.helper';
import { AccessService } from '@ghostfolio/api/services/access/access.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { scopes } from '@ghostfolio/common/scopes';
import type { RequestWithUser } from '@ghostfolio/common/types';

import { addDays } from 'date-fns';

import { AccessController } from './access.controller';

describe('AccessController', () => {
  let createAccess: jest.Mock;
  let controller: AccessController;

  beforeEach(() => {
    createAccess = jest.fn().mockImplementation(async (data) => {
      return {
        id: 'access-id',
        scopes: data.scopes,
        tokenHash: data.tokenHash
      };
    });

    controller = new AccessController(
      {
        buildSettings: jest.fn().mockReturnValue({}),
        createAccess
      } as unknown as AccessService,
      {
        get: (key: string) => key === 'ENABLE_FEATURE_MCP'
      } as unknown as ConfigurationService,
      { user: { id: 'user-id' } } as unknown as RequestWithUser
    );
  });

  const expiresAt = () => addDays(new Date(), 1).toISOString();

  it('Gives the token of an access of the type MCP once and stores only its hash', async () => {
    const result = await controller.createAccess({
      expiresAt: expiresAt(),
      type: 'MCP'
    });

    const { tokenHash } = createAccess.mock.calls[0][0];

    expect(result.token).toMatch(/^gfmcp_[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toEqual(hashMcpToken(result.token as string));
    expect(result).not.toHaveProperty('tokenHash');
  });

  it('Gives no token for an access of another type', async () => {
    const result = await controller.createAccess({
      expiresAt: expiresAt(),
      type: 'PUBLIC'
    });

    expect(result.token).toBeUndefined();
    expect(createAccess.mock.calls[0][0].tokenHash).toBeUndefined();
  });

  it('Drops the scopes which change data for a read only access', async () => {
    await controller.createAccess({
      expiresAt: expiresAt(),
      readOnly: true,
      scopes: [
        scopes.portfolioRead,
        scopes.reportCreate,
        scopes.activityCreate
      ],
      type: 'MCP'
    });

    expect(createAccess.mock.calls[0][0].scopes).toEqual([
      scopes.portfolioRead
    ]);
  });
});
