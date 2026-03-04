/**
 * Creates a timed error display helper.
 * Manages a timer that auto-clears the error after `timeoutMs` milliseconds.
 *
 * Usage in Svelte component:
 *   const timedError = createTimedError(3000)
 *   // To show: actionError = timedError.show('message')  (returns the message)
 *   // In onDestroy: timedError.cleanup()
 *
 * The caller owns the $state variable; this helper only manages the timer
 * and calls the provided setter to clear it.
 */
export function createTimedError(timeoutMs: number, setError: (v: string | null) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null

  function show(msg: string) {
    setError(msg)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { setError(null) }, timeoutMs)
  }

  function cleanup() {
    if (timer) clearTimeout(timer)
  }

  return { show, cleanup }
}
