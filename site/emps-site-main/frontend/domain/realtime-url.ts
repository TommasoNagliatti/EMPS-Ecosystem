/** HTTP API may be mounted at /api; Socket.IO namespace remains /realtime. */
export function realtimeUrl(apiUrl: string): string {
  return `${new URL(apiUrl).origin}/realtime`;
}
