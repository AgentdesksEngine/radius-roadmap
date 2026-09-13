/**
 * Work that outlives the response.
 *
 * Slack gives a webhook 3 seconds before it retries, and GitHub is similarly impatient, so
 * both routes ack immediately and finish afterwards. Vercel kills an invocation the moment
 * the response closes unless the promise is handed to `waitUntil` — which is imported
 * dynamically because scripts/dev-api.ts runs the same handlers with no platform underneath.
 */

/** Runs `fn` after the response is sent, keeping the invocation alive on Vercel. */
export async function afterResponse(fn: () => Promise<void>, label = 'background'): Promise<void> {
  const run = fn().catch((err) => console.error(`[${label}] work failed:`, err));
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(run);
  } catch {
    // Local dev has no platform to hand the promise to — just await it.
    await run;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
