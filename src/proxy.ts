import { NextRequest, NextResponse } from 'next/server'
import { ehAdmin } from '@/lib/sessao'

/**
 * Controle de acesso das APIs.
 *
 * O painel é de uso interno do escritório: toda rota de API exige login com a
 * conta Google do domínio (`@1comodo.online`). Só as rotas de autenticação são
 * públicas — elas precisam responder a quem ainda não entrou.
 *
 * O nome `proxy` é a convenção do Next 16 (era `middleware`). Este arquivo é o
 * que tranca as rotas; sumir com ele abriria todas.
 */

const PUBLICAS: { path: string; metodos: string[] }[] = [
  { path: '/api/auth/google', metodos: ['GET'] },
  { path: '/api/auth/google/callback', metodos: ['GET'] },
  { path: '/api/auth/logout', metodos: ['POST'] },
  { path: '/api/auth/me', metodos: ['GET'] },
]

export async function proxy(req: NextRequest) {
  const { method, nextUrl } = req
  const path = nextUrl.pathname

  if (PUBLICAS.some((r) => r.path === path && r.metodos.includes(method))) {
    return NextResponse.next()
  }

  if (!(await ehAdmin(req))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 401 })
  }

  return NextResponse.next()
}

// Só as APIs passam pelo proxy. As páginas se protegem sozinhas (checam o
// login pela interface); quem barra de verdade são estas rotas de API. Sem o
// matcher, o proxy rodaria em toda página e trancaria até a inicial.
export const config = {
  matcher: ['/api/:path*'],
}
