// =============================================================================
// Health Check — GET /api/health
// =============================================================================
// Used by the mobile app to test connectivity to the API server.
// Returns a simple JSON with the server status and current timestamp.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
