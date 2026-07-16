// Feature flags for the prototype.
//
// AUTH_ENABLED = false  → login page is bypassed. Every visitor is auto-signed
//   in as an admin so residents/reviewers can click straight into any dashboard
//   without going through OTP. The login route still exists and the backend
//   auth code is untouched — flip this to `true` when you're ready to require
//   real logins again.
export const AUTH_ENABLED = true;

// The identity that /guest visitors get when AUTH_ENABLED is false.
// Admin role so both Resident and Admin sections are reachable.
export const GUEST_SESSION = {
  email: "guest@prototype.local",
  name: "Prototype Guest",
  role: "admin" as const,
  issuedAt: 0,
};
