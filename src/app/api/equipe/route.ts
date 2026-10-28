import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin, lerCookieSessao, COOKIE_SESSAO } from '@/lib/sessao'
import { lerEquipe, salvarEquipe } from '@/lib/painel'
import type { Pessoa } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  return NextResponse.json({ equipe: await lerEquipe() })
}

export async function PUT(req: NextRequest) {
  // Trava: só a dona edita a equipe (cadastro sensível). Equipe só lê (GET).
  const sessao = await lerCookieSessao(req.cookies.get(COOKIE_SESSAO)?.value, process.env.ADMIN_SECRET || '')
  if (!sessao) return NextResponse.json({ error: 'Sem permissão' }, { status: 401 })
  if (sessao.papel !== 'dona') return NextResponse.json({ error: 'Só a responsável pode editar a equipe.' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as { equipe?: Pessoa[] } | null
  const bruta = Array.isArray(body?.equipe) ? body!.equipe : []
  const limpa: Pessoa[] = bruta
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({
      id: p.id,
      name: String(p.name).trim(),
      role: String(p.role || '').trim(),
      // Preserva o e-mail de login (antes estava sendo descartado aqui — causava o sumiço).
      email: typeof p.email === 'string' && p.email.trim() ? p.email.trim().toLowerCase() : undefined,
    }))
  await salvarEquipe(limpa)
  return NextResponse.json({ equipe: limpa })
}
