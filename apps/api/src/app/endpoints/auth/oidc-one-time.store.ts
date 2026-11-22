import { randomBytes } from 'node:crypto';

/**
 * In-memory store of values which can be consumed once and which expire. It
 * is used for the OIDC flow (state, nonce and PKCE verifier) and for the
 * exchange codes
 */
export class OidcOneTimeStore<T> {
  private entries = new Map<string, { expiresAt: number; value: T }>();

  public constructor(private readonly ttlInMilliseconds: number) {}

  /**
   * Consumes the value: it is removed even if it has expired
   */
  public consume(id?: string): T | undefined {
    if (!id) {
      return undefined;
    }

    const entry = this.entries.get(id);

    this.entries.delete(id);

    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }

    return entry.value;
  }

  /**
   * Stores the value and returns its cryptographically secure random id
   */
  public put(value: T) {
    this.cleanup();

    const id = randomBytes(32).toString('base64url');

    this.entries.set(id, {
      value,
      expiresAt: Date.now() + this.ttlInMilliseconds
    });

    return id;
  }

  private cleanup() {
    const now = Date.now();

    for (const [id, { expiresAt }] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(id);
      }
    }
  }
}
