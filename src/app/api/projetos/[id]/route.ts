import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/lib/sessao'
import { lerProjeto, salvarProjeto, excluirProjeto } from '@/lib/painel'
import type { Projeto } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  const { id } = await params
  const p = await lerProjeto(id)
  if (!p) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  return NextResponse.json({ projeto: p })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  const { id } = await params
  const existente = await lerProjeto(id)
  if (!existente) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as Projeto | null
  if (!body || body.id !== id || !Array.isArray(body.stages)) {
    return NextResponse.json({ error: 'Inválido' }, { status: 400 })
  }
  // createdAt é do que já está gravado; nunca vem do cliente.
  body.createdAt = existente.createdAt
  await salvarProjeto(body)
  return NextResponse.json({ projeto: body })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  const { id } = await params
  await excluirProjeto(id)
  return NextResponse.json({ ok: true })
}
