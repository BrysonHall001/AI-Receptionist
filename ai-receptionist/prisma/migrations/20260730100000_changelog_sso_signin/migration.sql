-- Changelog: SSO sign-in (Google + Microsoft), sign-in only
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_sso_signin_20260730',
  '2026-07-30',
  'Feature',
  'You can now offer Sign in with Google and Sign in with Microsoft on the sign-in screen. The buttons only appear once you have set them up; until then the sign-in screen is exactly as it is now, and everyone carries on using their email and password. The first time somebody uses one of these buttons, they are asked for their existing password once. That is deliberate. It proves the person holding the Google or Microsoft account is the same person who owns the account here, and it is the step that stops somebody who happens to control a matching email address from walking into an account that is not theirs. After that one time, it is a single click. THESE BUTTONS CANNOT CREATE AN ACCOUNT. If somebody signs in with a Google address that has no account here, nothing is created and they are simply told there is no account for that address. People still arrive the way they always have, by invitation. Signing in this way also grants nothing extra: an account that is switched off or expired is refused exactly as it would be with a password, and nobody can reach anything through these buttons that they could not reach by typing their password. Anyone can remove the connection later from Settings, Your account, and doing so cannot lock them out, because every account still has its password. One limitation worth knowing: Microsoft sign-in works with work and school accounts, not personal Microsoft accounts such as outlook.com or hotmail.com. This is not an oversight. Microsoft cannot confirm the email address on a personal account, and accepting an address nobody has confirmed is the exact weakness that lets someone take over an account that is not theirs. Anyone with a personal Microsoft account can still use Google or their password, and the message on screen tells them so.',
  'batch-sso-signin-20260730',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
