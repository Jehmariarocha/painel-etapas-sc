import { NextRequest, NextResponse } from 'next/server'
import { DOMINIO_DA_EQUIPE } from '@/lib/sessao'

export const dynamic = 'force-dynamic'

/**
 * Início do login: manda para a tela de contas do Google.
 *
 * O `state` é sorteado e guardado em cookie para ser conferido na volta — é
 * o que impede alguém de forjar o retorno do Google com um código próprio.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(new URL('/login?erro=configuracao', req.url))
  }

  const state = crypto.randomUUID()
  const destino = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  destino.searchParams.set('client_id', clientId)
  destino.searchParams.set('redirect_uri', new URL('/api/auth/google/callback', req.nextUrl.origin).toString())
  destino.searchParams.set('response_type', 'code')
  destino.searchParams.set('scope', 'openid email profile')
  destino.searchParams.set('state', state)
  // Dica de domínio: já abre a conta do escritório. Quem decide de verdade é
  // a checagem do e-mail na volta.
  destino.searchParams.set('hd', DOMINIO_DA_EQUIPE)
  destino.searchParams.set('prompt', 'select_account')

  const res = NextResponse.redirect(destino)
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}
