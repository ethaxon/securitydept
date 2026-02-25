# 04 - Basic Auth & SPA Compatibility - Basic Auth Zone

Integrating browser-native Basic Auth with a modern Single Page Application (SPA) presents unique UX challenges. If an AJAX `fetch` receives a `WWW-Authenticate` header, the browser might abruptly show a native login prompt, breaking the SPA flow. 

To solve this, `securitydept` employs a pattern called **"Challenge Zone Isolation"** combined with a **"Credential Poisoning"** logout hack.

## 1. Challenge Zone Isolation (Error Handling)
The API MUST NOT blindly return the `WWW-Authenticate` header for all `401 Unauthorized` responses. It should only be returned when explicitly requested via a designated "Challenge Route".

### Implementation Directive for `IntoResponse` on `AuthError`:

- When an authentication error occurs, the Axum error handler must inspect the request URI.
- **Rule A (Core APIs)**: If the path is `/api/v1/*`, return a JSON `401 Unauthorized` **WITHOUT** the `WWW-Authenticate` header.
- **Rule B (Challenge Trigger)**: If the path is `/basic/login` (a simple GET endpoint), return `401 Unauthorized` **WITH** `WWW-Authenticate: Basic realm="securitydept"`.
- **Rule C (Success Redirect)**: If a request to `/basic/login` contains valid Basic Auth credentials, return a `302 Found` redirecting back to the SPA root `/`.

*Frontend Flow: When the SPA needs Basic Auth, it navigates (`window.location.href = '/basic/login'`), triggering the native popup. Upon success, it is redirected back to the SPA.*

## 2. The Logout Hack (Credential Poisoning)

Browsers aggressively cache Basic Auth credentials and offer no JavaScript API to clear them. To implement a "Logout" button in the SPA, we must overwrite the browser's cached credentials with fake ones.

### Implementation Directive for the Logout Route:

Create a specific endpoint: `POST /basic/logout`.

- The SPA will call this via `fetch` sending fake credentials (e.g., `Authorization: Basic bG9nb3V0OmxvZ291dA==` which is `logout:logout`).
- **CRITICAL**: The backend handler for `/basic/logout` MUST ALWAYS return a `401 Unauthorized` **WITHOUT** the `WWW-Authenticate` header, regardless of what credentials were sent.
- If you include the `WWW-Authenticate` header here, the browser will trap the user in an uncloseable login popup loop when they try to log out.

By returning a silent 401, the browser quietly accepts the fake credentials, effectively "logging out" the user for future legitimate API calls.