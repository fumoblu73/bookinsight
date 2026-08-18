import { NextResponse } from 'next/server'
import { redisHealthy } from '@/lib/upstash'

export const dynamic = 'force-dynamic'

export async function GET() {
  const redis = await redisHealthy()
  return NextResponse.json(
    { redis: redis ? 'ok' : 'unreachable', checkedAt: new Date().toISOString() },
    { status: redis ? 200 : 503 },
  )
}
