export function getPublicOrigin() {
  // Priority 1: Environment variable
  const envUrl = import.meta.env.VITE_APP_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');

  // Priority 2: Current window location
  const origin = window.location.origin;
  
  // AI Studio specific: Dev URLs are restricted to the owner in the frame, 
  // but if we are sending emails, we want a URL that works.
  // -pre- URLs are the public "shared" URLs.
  if (origin.includes('-dev-')) {
    return origin.replace('-dev-', '-pre-');
  }
  
  return origin;
}
