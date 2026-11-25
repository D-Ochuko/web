/**
 * Safe Endpoint URL parser to prevent unhandled exceptions (#478)
 */
export function parseSafeEndpoint(
  urlCandidate: string | undefined,
  fallback: string = 'https://api.example.com'
): string {
  if (!urlCandidate) return fallback
  try {
    const parsed = new URL(urlCandidate)
    return parsed.toString()
  } catch {
    return fallback
  }
}
