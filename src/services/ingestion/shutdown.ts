// A process-wide "please stop" flag. Railway sends SIGTERM before replacing
// the container on a redeploy; long scrapes poll this flag between requests,
// save what they have read and end the run cleanly.

let stopping = false;

export function requestStop(): void {
  stopping = true;
}

export function stopRequested(): boolean {
  return stopping;
}

/** Test helper. */
export function resetStop(): void {
  stopping = false;
}
