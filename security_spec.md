# Firebase Security Specification - MINEAZY REQFLOW

## Data Invariants
- `settings/branding` is a global document containing the system logo.
- Only users with `ADMIN` role or identified as the master admin can update branding.
- All authenticated users can read branding.

## The "Dirty Dozen" Payloads (Branding Focus)
1. Someone tries to overwrite the logo without being logged in. (DENIED)
2. A regular requester tries to update the logo. (DENIED)
3. An admin tries to update the logo. (ALLOWED)
4. A malicious user tries to inject a 10MB string as a logo (size limit check). (DENIED)
5. A user tries to delete the branding document. (DENIED - unless admin)

## Test Runner (Simplified for branding)
The following tests will be performed using the Firestore Emulator/Simulator logic.
