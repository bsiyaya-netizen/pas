import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";

/**
 * Sign-in through the identity provider (OIDC authorization code + PKCE).
 * The portal never sees a password; it receives an access token that the API
 * verifies. The role shown here only shapes the menus: the API enforces it.
 */

export type Role = "broker" | "underwriter" | "admin";

export const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_AUTHORITY,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: `${window.location.origin}/`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  scope: import.meta.env.VITE_OIDC_SCOPE ?? "openid profile",
  // Session storage: a closed tab signs the user out.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

/**
 * Demo mode (`npm run demo`) signs in with sample tokens for each role instead
 * of the identity provider. Like VITE_DEV_TOKEN, Vite strips it from production builds.
 */
const demoTokens: Record<string, string> | undefined =
  import.meta.env.DEV && import.meta.env.VITE_DEMO_TOKENS ? JSON.parse(import.meta.env.VITE_DEMO_TOKENS) : undefined;
const DEMO_ROLE_KEY = "pas-demo-role";

export const demoRoles: string[] = demoTokens ? Object.keys(demoTokens) : [];

export function demoSignIn(role: string): void {
  window.sessionStorage.setItem(DEMO_ROLE_KEY, role);
  window.location.hash = "";
  window.location.reload();
}

export function signOut(): void {
  if (demoTokens) {
    window.sessionStorage.removeItem(DEMO_ROLE_KEY);
    window.location.hash = "";
    window.location.reload();
  } else {
    void userManager.signoutRedirect();
  }
}

/** Finishes a sign-in redirect if the URL carries one, then returns the signed-in user. */
export async function currentUser(): Promise<User | null> {
  if (demoTokens) {
    const role = window.sessionStorage.getItem(DEMO_ROLE_KEY);
    const token = role ? demoTokens[role] : undefined;
    if (!role || !token) return null;
    return new User({
      access_token: token,
      token_type: "Bearer",
      profile: { sub: role, iss: "demo", aud: "demo", exp: 0, iat: 0, name: `Demo ${role}` },
    });
  }
  // Local development only: `npm run dev:api` prints tokens to paste into VITE_DEV_TOKEN.
  // Vite strips this branch from production builds.
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_TOKEN) {
    return new User({
      access_token: import.meta.env.VITE_DEV_TOKEN,
      token_type: "Bearer",
      profile: { sub: "dev", iss: "dev", aud: "dev", exp: 0, iat: 0, name: "Local developer" },
    });
  }
  const params = new URLSearchParams(window.location.search);
  if (params.has("code") && params.has("state")) {
    const user = await userManager.signinRedirectCallback();
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    return user;
  }
  const user = await userManager.getUser();
  return user && !user.expired ? user : null;
}

/** Reads the role from the access token (Entra app roles), for display only. */
export function roleOf(user: User): Role | null {
  try {
    const payload = JSON.parse(atob(user.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    const claimed: string[] = [...(Array.isArray(payload.roles) ? payload.roles : []), payload.role]
      .filter((r): r is string => typeof r === "string")
      .map((r) => r.toLowerCase());
    return (["admin", "underwriter", "broker"] as const).find((r) => claimed.includes(r)) ?? null;
  } catch {
    return null;
  }
}
