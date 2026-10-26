import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_SESSAO } from '@/lib/sessao'

export const dynamic = 'force-dynamic'

/** Sair: limpa o cookie de sessão deste navegador. */
export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_SESSAO, '', { path: '/', maxAge: 0 })
  return res
}
