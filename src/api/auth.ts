import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Who is calling. Identity comes from a signed access token issued by the
 * identity provider (Microsoft Entra ID in production); this server never
 * handles passwords.
 *
 * The role comes from the token: Entra app roles arrive as a `roles` array
 * ("Broker", "Underwriter", "Admin"); other providers may send a single `role`.
 * Which broker or underwriter a person acts for is looked up in this system's
 * own `user_links` table by their user id (Entra's `oid`, else `sub`), so no
 * custom claims have to be configured in the identity provider.
 */
export type Actor =
  | { role: "broker"; subject: string; brokerId: string }
  | { role: "underwriter"; subject: string; underwriterId: string }
  | { role: "admin"; subject: string };

export interface Authenticator {
  /** Returns the caller, or throws AuthError for a missing, invalid or expired token. */
  authenticate(authorizationHeader: string | undefined): Promise<Actor>;
}

export interface UserLink {
  brokerId?: string;
  underwriterId?: string;
}

/** Finds the broker or underwriter a signed-in user acts for. */
export type LinkResolver = (subject: string) => Promise<UserLink | undefined>;

export class AuthError extends Error {
  constructor(
    message: string,
    /** 401 when the token itself is bad; 403 when it is fine but grants nothing. */
    readonly status: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface JwtConfig {
  issuer: string;
  audience: string;
  /** Signing keys: the provider's JWKS URL in production, or a key in tests. */
  key: JWTVerifyGetKey | Uint8Array;
  resolveLink: LinkResolver;
}

export function jwtAuthenticator(config: JwtConfig): Authenticator {
  const options = { issuer: config.issuer, audience: config.audience };
  return {
    async authenticate(header) {
      const token = header?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AuthError("Missing bearer token");
      let payload: JWTPayload;
      try {
        // Two calls because jwtVerify's overloads take a key or a key getter, not a union.
        payload = (
          config.key instanceof Uint8Array
            ? await jwtVerify(token, config.key, options)
            : await jwtVerify(token, config.key, options)
        ).payload;
      } catch {
        throw new AuthError("Invalid or expired token");
      }
      return toActor(payload, config.resolveLink);
    },
  };
}

/** Production setup: signing keys fetched (and cached) from the provider's JWKS endpoint. */
export function oidcAuthenticator(
  issuer: string,
  audience: string,
  jwksUrl: string,
  resolveLink: LinkResolver,
): Authenticator {
  return jwtAuthenticator({ issuer, audience, key: createRemoteJWKSet(new URL(jwksUrl)), resolveLink });
}

async function toActor(payload: JWTPayload, resolveLink: LinkResolver): Promise<Actor> {
  const subject = typeof payload.oid === "string" ? payload.oid : payload.sub;
  if (!subject) throw new AuthError("Token has no user id");

  const role = roleOf(payload);
  if (!role) throw new AuthError("Your account has no Broker, Underwriter or Admin role", 403);
  if (role === "admin") return { role, subject };

  const link = await resolveLink(subject);
  if (role === "broker" && link?.brokerId) return { role, subject, brokerId: link.brokerId };
  if (role === "underwriter" && link?.underwriterId) {
    return { role, subject, underwriterId: link.underwriterId };
  }
  throw new AuthError(`Your account is not linked to a ${role} yet; ask an administrator`, 403);
}

const ROLES = ["admin", "underwriter", "broker"] as const;

/** Highest-privilege recognised role, from `roles` (Entra app roles) or `role`. */
function roleOf(payload: JWTPayload): (typeof ROLES)[number] | undefined {
  const claimed = [
    ...(Array.isArray(payload.roles) ? payload.roles : []),
    ...(typeof payload.role === "string" ? [payload.role] : []),
  ]
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.toLowerCase());
  return ROLES.find((r) => claimed.includes(r));
}
