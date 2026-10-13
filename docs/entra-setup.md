# Setting up Microsoft Entra sign-in

Brokers, underwriters and admins sign in with Microsoft Entra ID. Entra checks
passwords and multi-factor authentication; the portal and API never see a
password. Allow about 30 minutes. Screen names below match the Entra admin
centre (entra.microsoft.com) at the time of writing and may move.

You need: an Azure account and the Entra tenant ID (Entra admin centre >
Overview > Tenant ID).

> **Brokers outside your company.** If brokers are separate businesses, invite
> them as guests (Users > Invite external user) in your tenant, or create a
> Microsoft Entra External ID tenant for them. Both work with these steps; with
> External ID the sign-in address is `https://<tenant-name>.ciamlogin.com/<tenant-id>/v2.0`
> instead of `https://login.microsoftonline.com/<tenant-id>/v2.0`.

## 1. Register the API

1. App registrations > New registration. Name: **PAS API**. Supported account
   types: this organisational directory only. No redirect URI. Register.
2. Note the **Application (client) ID**. This is the API's audience.
3. Manifest: set `"requestedAccessTokenVersion": 2` (older portals call it
   `accessTokenAcceptedVersion`). Save.
4. Expose an API > Add next to Application ID URI > accept `api://<client-id>`
   or set `api://pas-api`. Add a scope named **access**, who can consent:
   admins only, then save.
5. App roles > Create app role, three times:

   | Display name | Value | Allowed member types |
   | --- | --- | --- |
   | Broker | `Broker` | Users/Groups |
   | Underwriter | `Underwriter` | Users/Groups |
   | Admin | `Admin` | Users/Groups |

## 2. Register the portal

1. App registrations > New registration. Name: **PAS Portal**. Redirect URI:
   platform **Single-page application**, `http://localhost:5173/` for local
   development. Add your live portal address (for example
   `https://portal.example.co.za/`) under Authentication when you have one.
2. Note this **Application (client) ID** too.
3. API permissions > Add a permission > My APIs > PAS API > Delegated >
   **access** > Add. Then **Grant admin consent**.

## 3. Give people a role

Enterprise applications > **PAS API** > Users and groups > Add user/group.
Pick the person and the role (Broker, Underwriter or Admin). Assign roles on
**PAS API**, not on PAS Portal: the role travels in the API's access token.

## 4. Configure the API and portal

API environment variables:

```
AUTH_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
AUTH_AUDIENCE=<PAS API client id>
AUTH_JWKS_URL=https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
```

Portal (`web/.env.local`, or build-time variables when deploying):

```
VITE_OIDC_AUTHORITY=https://login.microsoftonline.com/<tenant-id>/v2.0
VITE_OIDC_CLIENT_ID=<PAS Portal client id>
VITE_OIDC_SCOPE=openid profile api://pas-api/access
```

Use the Application ID URI you chose in step 1.4 in the scope.

## 5. Link each person to their broker or underwriter

Entra says *what* someone is (Broker); this system records *which* broker firm
or underwriter they are. For each person, copy their **Object ID** (Users >
the person > Overview) and, signed in as an Admin, call:

```
PUT /user-links
{ "subject": "<object id>", "brokerId": "<broker id>" }
```

or `"underwriterId"` for an underwriter. Until linked, a person who signs in
sees "Your account is not linked to a broker yet; ask an administrator".
