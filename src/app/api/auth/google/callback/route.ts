import { NextRequest, NextResponse } from 'next/server'
import { criarCookieSessao, papelDoEmail, COOKIE_SESSAO, TRINTA_DIAS } from '@/lib/sessao'

export const dynamic = 'force-dynamic'

/**
 * Volta do Google: troca o código por um token, confere quem é, e cria a
 * sessão do escritório.
 *
 * O `id_token` não tem a assinatura verificada aqui de propósito: ele vem do
 * próprio endpoint do Google, por TLS, em troca do nosso `client_secret` —
 * é o caminho em que o OpenID Connect dispensa a verificação. O que **não**
 * pode faltar é conferir o `state` e o domínio do e-mail.
 *
 * Diferente da estimadora, aqui não há lista de usuários nem bloqueio: quem é
 * do domínio do escritório entra. A ferramenta é de uso interno.
 */
export async function GET(req: NextRequest) {
  const erro = (motivo: string) => NextResponse.redirect(new URL(`/login?erro=${motivo}`, req.url))

  // Cada variável com seu código de erro — faltar um caractere no segredo já
  // custou meia hora de procura às cegas na estimadora.
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return erro('sem_client_id')
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientSecret) return erro('sem_client_secret')
  const segredo = process.env.ADMIN_SECRET
  if (!segredo) return erro('sem_admin_secret')

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const stateCookie = req.cookies.get('oauth_state')?.value
  if (!code) return erro('cancelado')
  if (!state || !stateCookie || state !== stateCookie) return erro('state')

  let email: string
  try {
    const resposta = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: new URL('/api/auth/google/callback', req.nextUrl.origin).toString(),
        grant_type: 'authorization_code',
      }),
    })
    if (!resposta.ok) return erro('token')
    const { id_token } = (await resposta.json()) as { id_token?: string }
    if (!id_token) return erro('token')

    const corpo = JSON.parse(
      Buffer.from(id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { email?: string; email_verified?: boolean | string }

    if (!corpo.email || corpo.email_verified === false || corpo.email_verified === 'false') {
      return erro('email')
    }
    email = corpo.email
  } catch {
    return erro('token')
  }

  const papel = papelDoEmail(email, process.env.DONO_EMAIL)
  if (!papel) return erro('dominio')

  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.set(COOKIE_SESSAO, await criarCookieSessao(email, papel, segredo), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TRINTA_DIAS,
    secure: process.env.NODE_ENV === 'production',
  })
  res.cookies.delete('oauth_state')
  return res
}
