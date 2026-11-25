/**
 * "User disconnected" flag for the Freighter wallet.
 *
 * Disconnecting in the app only clears the app's own view of the session: the
 * site stays authorised inside Freighter, so the next page load's auto-probe
 * would find the address and silently reconnect. This flag records the user's
 * intent so the probe can be skipped until they explicitly press Connect.
 *
 * Only a boolean marker is stored, never the public key.
 */

export const USER_DISCONNECTED_KEY = 'txwatch_user_disconnected'

/** Shown after a disconnect: the app cannot revoke access inside Freighter. */
export const FREIGHTER_REVOKE_HINT =
  'You disconnected this site. Freighter still remembers it as approved, so to ' +
  'revoke access fully, open Freighter, go to Settings and remove this site from ' +
  'the list of connected apps.'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function isUserDisconnected(): boolean {
  try {
    return storage()?.getItem(USER_DISCONNECTED_KEY) === '1'
  } catch {
    return false
  }
}

export function setUserDisconnected(): void {
  try {
    storage()?.setItem(USER_DISCONNECTED_KEY, '1')
  } catch {
    // Storage unavailable: the disconnect still applies for this page view.
  }
}

export function clearUserDisconnected(): void {
  try {
    storage()?.removeItem(USER_DISCONNECTED_KEY)
  } catch {
    // Nothing to clear.
  }
}
