export function getPublicOrigin() {
  const origin = window.location.origin;
  // AI Studio specific: Dev URLs are restricted, Pre URLs are public
  if (origin.includes('-dev-')) {
    return origin.replace('-dev-', '-pre-');
  }
  return origin;
}
