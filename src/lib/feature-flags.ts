// Feature flags for the prototype.
//
// AUTH_ENABLED = false  → login page is bypassed. Every visitor is auto-signed
//   in as an admin so residents/reviewers can click straight into any dashboard
//   without going through OTP. The login route still exists and the backend
//   auth code is untouched — flip this to `true` when you're ready to require
//   real logins again.
// SECURITY: hardcoded true is correct today, but a future contributor could
// flip this to false for local UI testing and forget to revert it before a
// deploy. Force it true in production builds regardless of the toggle
// below, so that mistake can only ever affect a local dev server.
const DEV_ONLY_AUTH_TOGGLE = true; // set to false LOCALLY ONLY to skip login while testing UI -- never commit as false
export const AUTH_ENABLED = (import.meta as any).env?.PROD ? true : DEV_ONLY_AUTH_TOGGLE;

// The identity that /guest visitors get when AUTH_ENABLED is false.
// Admin role so both Resident and Admin sections are reachable.
export const GUEST_SESSION = {
  email: "guest@prototype.local",
  name: "Prototype Guest",
  role: "admin" as const,
  issuedAt: 0,
};
