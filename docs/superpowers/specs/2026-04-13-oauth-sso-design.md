# OAuth/SSO Login — Design Spec

## Problem

Users can only sign in with email/password. Adding Google and GitHub OAuth makes onboarding faster and reduces password fatigue.

## Solution

Add OAuth2 authorization code flow for Google and GitHub. Users click a button, get redirected to the provider, and are redirected back with an authenticated session. Accounts are linked by email — if a user registered with email/password first, they can later sign in with Google (or vice versa) and it maps to the same account.

## Backend Changes

### 1. User model — OAuth columns

Add two nullable columns to the `users` table:

- `oauth_provider`: `String(20)`, nullable — `"google"`, `"github"`, or null (email/password user)
- `oauth_id`: `String(255)`, nullable — the provider's unique user ID

Both default to null. Existing users are unaffected. A user who registered via email/password and later signs in via Google will have their `oauth_provider` and `oauth_id` populated on first OAuth login.

Migration: `ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(20), ADD COLUMN oauth_id VARCHAR(255)`

### 2. Dependency — `authlib`

Add `authlib[httpx]>=1.3.0` to `requirements.txt`. Authlib handles the OAuth2 flow: building authorization URLs, exchanging codes for tokens, and fetching user info from provider APIs.

### 3. OAuth config in Settings

Add to `app/config.py`:

- `google_client_id: Optional[str] = None`
- `google_client_secret: Optional[str] = None`
- `github_client_id: Optional[str] = None`
- `github_client_secret: Optional[str] = None`

Mapped from env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

### 4. OAuth registry setup

Create `app/auth/oauth.py` — registers Google and GitHub as OAuth clients using Authlib's `OAuth` class:

- Google: authorize URL `https://accounts.google.com/o/oauth2/auth`, token URL `https://oauth2.googleapis.com/token`, userinfo URL `https://www.googleapis.com/oauth2/v3/userinfo`, scope `openid email profile`
- GitHub: authorize URL `https://github.com/login/oauth/authorize`, token URL `https://github.com/login/oauth/access_token`, userinfo URL `https://api.github.com/user`, scope `user:email`

### 5. OAuth routes

Add to `app/routers/auth.py`:

**`GET /api/auth/google`** — Redirects to Google consent screen
- Builds authorization URL with redirect_uri = `{backend_url}/api/auth/google/callback`
- Stores OAuth state in a short-lived cookie (for CSRF protection)

**`GET /api/auth/google/callback`** — Google redirects here after consent
- Exchanges authorization code for access token
- Fetches user profile (email, name, Google user ID)
- Create-or-link logic (see below)
- Sets JWT cookies (same as regular login)
- Redirects to frontend: `http://localhost:3000/`

**`GET /api/auth/github`** — Same pattern as Google

**`GET /api/auth/github/callback`** — Same pattern as Google
- GitHub quirk: email may be private, need to also call `GET /user/emails` API to get primary email

**`GET /api/auth/providers`** — Returns which providers are configured
- Response: `{"google": true, "github": false}` based on whether client IDs are set in env
- No authentication required

### 6. Create-or-link logic (in callback)

```
email = provider_user_info.email
existing_user = db.query(User).filter(User.email == email).first()

if existing_user:
    # Link: update OAuth fields if not already set
    if not existing_user.oauth_provider:
        existing_user.oauth_provider = provider_name
        existing_user.oauth_id = provider_user_id
    # Log in as existing user
    user = existing_user
else:
    # Create new account (no password needed)
    user = User(
        email=email,
        name=provider_user_info.name,
        password_hash="",  # empty — cannot login via password
        oauth_provider=provider_name,
        oauth_id=provider_user_id,
    )
    db.add(user)

# Admin auto-promotion (same as email/password login)
if email in settings.admin_emails:
    user.role = "admin"

db.commit()
# Set JWT cookies + redirect to frontend
```

Users created via OAuth have `password_hash=""` — they cannot sign in via the email/password form. They must use OAuth. If they want to set a password later, that's a future feature (not in scope).

### 7. Frontend redirect URL

The callback redirects to `http://localhost:3000/` after setting cookies. For production, add `FRONTEND_URL` env var (defaults to `http://localhost:3000`).

Add `frontend_url: str = "http://localhost:3000"` to Settings, mapped from `FRONTEND_URL` env var.

## Frontend Changes

### 8. Login page — OAuth buttons

In `app/login/page.tsx`, add above the email form:

- "Sign in with Google" button (Google colors/icon)
- "Sign in with GitHub" button (GitHub colors/icon)
- "or" divider between OAuth buttons and the email form

Buttons are plain `<a>` links pointing to `{API_BASE}/api/auth/google` and `{API_BASE}/api/auth/github`. Full-page redirect — no JS SDK needed.

### 9. Register page — same buttons

In `app/register/page.tsx`, add the same OAuth buttons above the registration form. The OAuth flow handles both login and registration — same endpoint.

### 10. Auth dialog (modal) — same buttons

In `components/auth-dialog.tsx`, add OAuth buttons in both the "Sign in" and "Sign up" tabs.

### 11. Conditional rendering

On mount, call `GET /api/auth/providers` to check which providers are configured. Hide buttons for unconfigured providers. If no providers are configured, don't show the OAuth section or divider at all.

Add to `lib/api.ts`:
```typescript
export async function getAuthProviders(): Promise<{ google: boolean; github: boolean }> {
  const res = await fetch(`${API_BASE}/api/auth/providers`);
  return res.json();
}
```

## Migration

Single Alembic migration:
- Add `oauth_provider` VARCHAR(20) nullable to `users`
- Add `oauth_id` VARCHAR(255) nullable to `users`

## Env Vars

```env
# OAuth (all optional — buttons hidden if not set)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
FRONTEND_URL=http://localhost:3000
```

## Edge Cases

- **GitHub private email**: GitHub may not return email in profile. Must also call `GET /user/emails` to get primary verified email. If no verified email found, reject with error.
- **OAuth user tries email/password login**: `password_hash` is empty, `verify_password` returns false, login fails. User sees "Invalid credentials" — could improve with "Try signing in with Google" message, but not in scope.
- **Email/password user signs in with OAuth (different provider)**: First OAuth login links the account. If they later try a *different* OAuth provider with the same email, `oauth_provider` is already set to the first provider. Allow login anyway (email match is sufficient) but don't overwrite existing `oauth_provider`/`oauth_id`.
- **OAuth state cookie for CSRF**: Short-lived (5 min), httpOnly, same-site. Verified on callback.

## Files to Modify

| File | Change |
|------|--------|
| `backend/requirements.txt` | Add `authlib[httpx]>=1.3.0` |
| `backend/app/models/user.py` | Add `oauth_provider`, `oauth_id` columns |
| `backend/app/config.py` | Add OAuth + frontend_url settings |
| `backend/app/auth/oauth.py` | New — OAuth registry setup |
| `backend/app/routers/auth.py` | Add 5 new endpoints |
| `backend/app/schemas/auth.py` | Add `ProvidersResponse` schema |
| `backend/alembic/versions/` | New migration |
| `frontend/src/lib/api.ts` | Add `getAuthProviders()` |
| `frontend/src/app/login/page.tsx` | Add OAuth buttons |
| `frontend/src/app/register/page.tsx` | Add OAuth buttons |
| `frontend/src/components/auth-dialog.tsx` | Add OAuth buttons |
