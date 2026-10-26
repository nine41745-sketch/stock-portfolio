export const dynamic = 'force-dynamic'
export const revalidate = 0

const identityHeaders = { 'cache-control': 'private, no-store, max-age=0' }

/** Public, non-secret marker used to distinguish the active Production deployment from a Staged build. */
export async function GET() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID
  if (typeof deploymentId !== 'string' || !deploymentId.trim()) {
    return Response.json({ error: 'Deployment identity unavailable' }, { status: 503, headers: identityHeaders })
  }

  return Response.json({ deploymentId }, { headers: identityHeaders })
}
