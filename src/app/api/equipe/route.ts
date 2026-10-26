import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/lib/sessao'
import { lerEquipe, salvarEquipe } from '@/lib/painel'
import type { Pessoa } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  return NextResponse.json({ equipe: await lerEquipe() })
}

export async function PUT(req: NextRequest) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  const body = (await req.json().catch(() => null)) as { equipe?: Pessoa[] } | null
  const bruta = Array.isArray(body?.equipe) ? body!.equipe : []
  const limpa: Pessoa[] = bruta
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({ id: p.id, name: String(p.name).trim(), role: String(p.role || '').trim() }))
  await salvarEquipe(limpa)
  return NextResponse.json({ equipe: limpa })
}
