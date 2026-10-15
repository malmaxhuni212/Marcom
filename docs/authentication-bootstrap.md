# Netlify shared-access bootstrap

This runbook covers `AUTH-001` administrator recovery and the relevant `AUTH-004` deployment controls. It creates the first shared pilot credential without requiring a human-accessible production write URL.

## Why this flow exists

Netlify Developer accounts receive a read-only production database connection. The deployed application still needs write access for normal product operations. In a Netlify runtime, MARCOM obtains the correct production or preview branch connection through `@netlify/database`.

Schema and non-secret foundation records are created by committed migrations. Passwords are application data and must never be placed in a migration, repository file, build log or Netlify variable.

## Safety properties

- Bootstrap is available only when `APP_ACCESS_MODE=shared` and `AUTH_BOOTSTRAP_SECRET` contains at least 32 characters.
- The setup token is compared using fixed-length cryptographic digests.
- The endpoint requires the configured `APP_ORIGIN` and rejects cross-origin requests.
- The request size is bounded and validated with a strict schema.
- The password is hashed by the existing scrypt credential service and is never logged or returned.
- The workspace row is locked while the first password identity is created.
- A second bootstrap request cannot create another password identity.
- Removing `AUTH_BOOTSTRAP_SECRET` disables the endpoint without a code change.

## First production setup

### 1. Check Netlify variables

Set these variables for the Production context:

```text
APP_ACCESS_MODE=shared
APP_ORIGIN=https://YOUR-SITE.netlify.app
AUTH_SECRET=YOUR_EXISTING_LONG_RANDOM_SESSION_SECRET
AUTH_BOOTSTRAP_SECRET=TEMPORARY_RANDOM_SETUP_TOKEN
```

Use Runtime scope for `AUTH_BOOTSTRAP_SECRET`. Do not manually add a copied read-only value for `NETLIFY_DB_URL`. Netlify Database supplies that value to the application runtime.

Generate the temporary token locally in PowerShell without using an online generator:

```powershell
$randomBytes = New-Object byte[] 48
$randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($randomBytes)
$bootstrapSecret = [Convert]::ToBase64String($randomBytes)
$randomGenerator.Dispose()
$bootstrapSecret
```

Copy the output into Netlify as `AUTH_BOOTSTRAP_SECRET`. Do not commit it.

### 2. Deploy

Deploy the application. Netlify applies the pilot-foundation migration before publishing. The migration creates the stable workspace, local actor and membership, but no password credential.

### 3. Create the credential

Open:

```text
https://YOUR-SITE.netlify.app/bootstrap
```

Enter:

- the temporary setup token;
- a lowercase username such as `marcom-pilot`;
- a display name;
- a password between 16 and 128 characters.

Successful setup creates the password user, workspace membership and audit event in one database transaction.

### 4. Disable bootstrap

Immediately delete `AUTH_BOOTSTRAP_SECRET` from the Netlify Production environment and trigger another production deploy. Submitting `/bootstrap` after that must return the generic disabled-token message.

### 5. Verify access

Open `/login` in a private browser window and sign in with the new username and password. Confirm that protected pages load and logout invalidates the session.

## Expected failures

| Result | Meaning | Action |
| --- | --- | --- |
| Bootstrap is disabled or token is incorrect | The token is absent, too short, scoped incorrectly or mistyped | Check the Production Runtime variable and redeploy |
| Shared pilot access has already been configured | A password identity already exists in the pilot workspace | Use the login page; do not try to bootstrap another identity |
| Database foundation is not ready | The foundation migration has not been applied | Inspect the latest production deploy migration stage |
| Internal server error | Runtime database access or another server dependency failed | Inspect the request ID in Netlify function logs without exposing secrets |

## Recovery boundary

This endpoint is intentionally for first-user bootstrap only. It does not rotate an existing credential. Existing-password rotation remains `npm run auth:rotate-password` when an administrator has an approved writable connection. A separate authenticated administrator recovery operation requires its own reviewed task before it is exposed over the network.
