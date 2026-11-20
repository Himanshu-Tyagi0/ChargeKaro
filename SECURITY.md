# ChargeKaro Security Architecture (`SECURITY.md`)

ChargeKaro implements defense-in-depth across authentication, authorization, database concurrency, API hygiene, WebSockets, and LLM agent execution.

## 1. Authentication & Session Security
- **Password Hashing:** Argon2id (`argon2-cffi`) for all user passwords.
- **Password Policy:** Enforces minimum 8 characters, uppercase, lowercase, digit, and special character on registration (`backend/app/security/passwords.py`).
- **Brute-Force Lockout:** Repeated failed logins (>= 5 attempts) lock the account for 5 minutes and emit `LOGIN_FAILED` audit events.
- **Tokens & Cookies:** Short-lived JWT access tokens (15 minutes) paired with rotating refresh tokens stored as SHA-256 hashes in the `refresh_tokens` table and delivered via `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookies.
- **Refresh Reuse Detection:** Presenting a revoked or expired refresh token immediately revokes the entire token family.
- **Logout:** Revokes the active refresh token in the database and clears auth cookies.

## 2. Authorization (RBAC & IDOR Prevention)
- **Backend-Enforced RBAC:** Every protected route uses `require_roles(UserRole.OWNER, UserRole.ADMIN)` or `require_roles(UserRole.ADMIN)` on the server (`backend/app/security/deps.py`).
- **Ownership Checks (IDOR Prevention):**
  - Station Owners can edit or add chargers **only** on stations where `station.owner_id == current_user.id`.
  - Drivers can view, cancel, reschedule, check in, and stop sessions **only** on bookings/sessions where `user_id == current_user.id`.
  - Public registration prevents self-assignment of the `admin` role.

## 3. Input Validation, SQL Injection & XSS Defense
- **Strict Pydantic Schemas:** All request bodies inherit `StrictModel` (`ConfigDict(extra="forbid")`) with explicit string length, numeric range, and enum constraints. Unexpected fields return `422`.
- **SQL Injection:** All queries use SQLAlchemy 2.0 ORM parameterized statements (`select(...)`). No raw string-interpolated SQL exists anywhere in the codebase.
- **XSS Prevention:** React escapes all rendered text by default; `dangerouslySetInnerHTML` is never used.

## 4. Network & Transport Security
- **Rate Limiting:** `slowapi` enforces per-user/per-IP limits (`12/min` on login, `20/min` on booking creation, `30/min` on AI endpoints).
- **CORS:** Restricted explicitly to configured `FRONTEND_ORIGIN` / `ALLOWED_ORIGINS` with credentials enabled.
- **Security Headers (`SecurityHeadersMiddleware`):** Adds `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Correlation-ID`, and `Strict-Transport-Security` in production.
- **CSRF Protection:** Double-submit HMAC-signed `ck_csrf` cookie + `X-CSRF-Token` header verification on cookie-authenticated state-changing requests.

## 5. WebSocket Security
- `/ws/status` broadcasts **only** non-sensitive public fields (`station_id`, `charger_id`, `status`, `last_updated`).
- `/ws/me` authenticates the JWT token before accepting user-scoped subscriptions and delivers booking/alert events strictly to the matching `user_id`.

## 6. Booking & Payment Integrity
- **Double-Booking Prevention:** `create_booking_transactional` acquires an immediate database write lock (`BEGIN IMMEDIATE` on SQLite / `SELECT ... FOR UPDATE` on PostgreSQL) and checks active interval overlaps inside the transaction.
- **Idempotency Keys:** `POST /api/v1/bookings` accepts `Idempotency-Key` so network retries return the existing booking without duplicate charges or slots.
- **Single-Use Signed QR Tokens:** Check-in QR tokens are HMAC-SHA256 JWTs signed with `QR_SECRET`, bound to `(booking_id, user_id, charger_id, jti)` with `qr_used` single-use enforcement.
- **Mock Payment Privacy:** Payment UI is strictly a demo sandbox (`MOCK_UPI` / `MOCK_CARD`); real card numbers/CVVs are never accepted or persisted.

## 7. AI Agent Security
- **Prompt Injection Defense:** User prompts and station metadata are wrapped in `<untrusted_user_message>` delimiters; system instructions forbid treating data as commands.
- **Whitelisted Tools Only:** The LLM cannot run code or SQL—it may only call 6 strictly typed backend functions validated by Pydantic schemas.
- **Permission Inheritance:** Every tool executes strictly under the currently authenticated `User` object.
- **Explicit Confirmation Gate:** Write actions (`propose_booking`, `propose_cancel_booking`) stage a server-side `PendingConfirmation` (`action_id`) that only executes when the user explicitly confirms.
- **Tool & Audit Logging:** Every AI tool call, login, booking, cancellation, charger override, and admin demo action is logged to `audit_logs` with PII masking (`mask_pii`) and correlation IDs.

## 8. Error Handling & Dependency Hygiene
- **Zero Stack Trace Leakage:** Unhandled exceptions are logged server-side with `X-Correlation-ID` and return generic JSON error payloads to clients.
- **Pinned Dependencies & Auditing:** All Python dependencies in `backend/requirements.txt` and JS packages are pinned. Run regularly:
  ```bash
  cd backend && .venv/bin/pip-audit   # (if installed)
  npm audit
  ```
