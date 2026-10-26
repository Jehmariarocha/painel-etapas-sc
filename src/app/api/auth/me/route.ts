import { NextRequest, NextResponse } from 'next/server'
import { ehAdmin } from '@/lib/sessao'

export const dynamic = 'force-dynamic'

/** Diz ao cliente se este navegador é o escritório. */
export async function GET(req: NextRequest) {
  return NextResponse.json({ admin: await ehAdmin(req) })
}
