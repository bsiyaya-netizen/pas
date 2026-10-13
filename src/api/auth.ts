import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Who is calling. Identity comes from a signed access token issued by the
 * identity provider (OIDC); this server never handles passwords.
 *
 * Expected claims:
 *   role          "broker" | "underwriter" | "admin"
 *   broker_id     for brokers: the brokers.id they act for
 *   underwriter_id for underwriters: the underwriters.id they are
 */
export type Actor =
  | { role: "broker"; subject: string; brokerId: string }
  | { role: "underwriter"; subject: string; underwriterId: string }
  | { role: "admin"; subject: string };

export interface Authenticator {
  /** Returns the caller, or throws AuthError for a missing, invalid or expired token. */
  authenticate(authorizationHeader: string | undefined): Promise<Actor>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface JwtConfig {
  issuer: string;
  audience: string;
  /** Signing keys: the provider's JWKS URL in production, or a key in tests. */
  key: JWTVerifyGetKey | Uint8Array;
}

export function jwtAuthenticator(config: JwtConfig): Authenticator {
  return {
    async authenticate(header) {
      const token = header?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AuthError("Missing bearer token");
      let payload: JWTPayload;
      try {
        const verified =
          config.key instanceof Uint8Array
            ? await jwtVerify(token, config.key, { issuer: config.issuer, audience: config.audience })
            : await jwtVerify(token, config.key, { issuer: config.issuer, audience: config.audience });
        payload = verified.payload;
      } catch {
        throw new AuthError("Invalid or expired token");
      }
      return toActor(payload);
    },
  };
}

/** Production setup: keys fetched (and cached) from the identity provider's JWKS endpoint. */
export function oidcAuthenticator(issuer: string, audience: string, jwksUrl: string): Authenticator {
  return jwtAuthenticator({ issuer, audience, key: createRemoteJWKSet(new URL(jwksUrl)) });
}

function toActor(payload: JWTPayload): Actor {
  const subject = payload.sub;
  if (!subject) throw new AuthError("Token has no subject");
  const claim = (name: string) => {
    const value = payload[name];
    if (typeof value !== "string" || !value) throw new AuthError(`Token is missing the ${name} claim`);
    return value;
  };
  switch (payload.role) {
    case "broker":
      return { role: "broker", subject, brokerId: claim("broker_id") };
    case "underwriter":
      return { role: "underwriter", subject, underwriterId: claim("underwriter_id") };
    case "admin":
      return { role: "admin", subject };
    default:
      throw new AuthError("Token has no recognised role");
  }
}
