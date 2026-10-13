/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OIDC_AUTHORITY: string;
  readonly VITE_OIDC_CLIENT_ID: string;
  readonly VITE_OIDC_SCOPE?: string;
  readonly VITE_API_BASE?: string;
  /** Development only: a token from `npm run dev:api`, skipping the sign-in redirect. */
  readonly VITE_DEV_TOKEN?: string;
  /** JSON map of role to sample token, set by `npm run demo`. */
  readonly VITE_DEMO_TOKENS?: string;
}
