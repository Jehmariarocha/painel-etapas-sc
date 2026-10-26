import { NextRequest, NextResponse } from 'next/server'
import { ehSandbox } from '@/lib/chaves'
import { lerCookieSessao, COOKIE_SESSAO } from '@/lib/sessao'
import { listarProjetos, lerEquipe } from '@/lib/painel'
import type { Projeto, Pessoa } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

/**
 * Alerta automático de prazos — roda uma vez por dia (Vercel Cron, ver
 * `vercel.json`). Varre as etapas, acha as vencidas e as a vencer (até 3 dias),
 * e manda um e-mail de resumo para o escritório. Se não houver nada, não envia.
 *
 * Fica FORA de `/api` de propósito: o `proxy.ts` só tranca `/api/*`, então esta
 * rota não passa pelo login — ela se protege sozinha pelo segredo do cron
 * (`CRON_SECRET`), que a Vercel manda no header `Authorization: Bearer ...`.
 * No desenvolvimento local libera sem segredo, para dar para testar.
 */

const APP_URL = 'https://painel-etapas-sc-7mrk.vercel.app'
const DIAS_A_VENCER = 3
const DE = 'Painel de Etapas 1Comodo <onboarding@resend.dev>'

/** Data de hoje (YYYY-MM-DD) no horário de Brasília (UTC-3). */
function hojeISO_BRT(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
/** Dias de calendário entre hoje (BRT) e o prazo. Negativo = já passou. */
function diasAte(dueISO: string): number {
  const a = Date.parse(dueISO + 'T00:00:00Z')
  const b = Date.parse(hojeISO_BRT() + 'T00:00:00Z')
  return Math.round((a - b) / 86400000)
}
function fmtData(iso: string): string {
  const p = iso.split('-')
  return `${p[2]}/${p[1]}/${p[0]}`
}
function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

interface Item {
  projeto: string
  etapa: string
  codigo: string
  resp: string
  due: string
  dias: number
}

function coletar(projetos: Projeto[], equipe: Pessoa[]): { vencidas: Item[]; aVencer: Item[] } {
  const nome = (id: string | null) => {
    const p = equipe.find((x) => x.id === id)
    return p ? p.name + (p.role ? ` (${p.role})` : '') : '—'
  }
  const vencidas: Item[] = []
  const aVencer: Item[] = []
  for (const proj of projetos) {
    for (const st of proj.stages) {
      if (!st.due || st.status === 'concluida') continue
      const d = diasAte(st.due)
      const item: Item = {
        projeto: proj.name,
        etapa: st.name,
        codigo: st.code,
        resp: nome(st.personId),
        due: st.due,
        dias: d,
      }
      if (d < 0) vencidas.push(item)
      else if (d <= DIAS_A_VENCER) aVencer.push(item)
    }
  }
  vencidas.sort((a, b) => a.dias - b.dias)
  aVencer.sort((a, b) => a.dias - b.dias)
  return { vencidas, aVencer }
}

function linha(it: Item, atrasada: boolean): string {
  const quando = atrasada
    ? `venceu em ${fmtData(it.due)} (há ${Math.abs(it.dias)} dia${Math.abs(it.dias) === 1 ? '' : 's'})`
    : it.dias === 0
      ? `vence hoje (${fmtData(it.due)})`
      : `vence em ${it.dias} dia${it.dias === 1 ? '' : 's'} (${fmtData(it.due)})`
  const cor = atrasada ? '#c0392b' : '#7a6200'
  return `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:14px"><b>${esc(it.projeto)}</b><br><span style="color:#666">${esc(it.codigo)} · ${esc(it.etapa)}</span></td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;color:#444">${esc(it.resp)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;color:${cor};font-weight:600;white-space:nowrap">${quando}</td>
  </tr>`
}

function montarHtml(vencidas: Item[], aVencer: Item[]): string {
  const secao = (titulo: string, itens: Item[], atrasada: boolean) =>
    itens.length === 0
      ? ''
      : `<h3 style="margin:22px 0 8px;font-size:15px;color:#1a1a1a">${titulo} (${itens.length})</h3>
         <table style="border-collapse:collapse;width:100%">${itens.map((i) => linha(i, atrasada)).join('')}</table>`
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
    <div style="background:#ffd600;color:#1f1d18;padding:14px 16px;border-radius:10px 10px 0 0">
      <b style="font-size:16px">1COMODO</b> · Painel de Etapas de Projeto
    </div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px;padding:16px">
      <p style="font-size:14px;color:#444;margin:0 0 4px">Resumo de prazos de ${fmtData(hojeISO_BRT())}:</p>
      ${secao('⚠️ Etapas atrasadas', vencidas, true)}
      ${secao('⏳ A vencer', aVencer, false)}
      <p style="margin:24px 0 0"><a href="${APP_URL}" style="background:#ffd600;color:#1f1d18;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;display:inline-block;font-size:14px">Abrir o painel</a></p>
      <p style="margin:16px 0 0;font-size:11px;color:#999">E-mail automático diário do Painel de Etapas.</p>
    </div>
  </div>`
}

async function enviarEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY ausente')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: DE, to, subject, html }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
  return r.json()
}

export async function GET(req: NextRequest) {
  // Proteção: no local libera (para testar). Em produção, aceita o cron da
  // Vercel (header Bearer CRON_SECRET) OU alguém do escritório logado (disparo
  // manual pela barra de endereço).
  if (!ehSandbox()) {
    const segredo = process.env.CRON_SECRET
    const temBearer = !!segredo && req.headers.get('authorization') === `Bearer ${segredo}`
    const sessao = await lerCookieSessao(req.cookies.get(COOKIE_SESSAO)?.value, process.env.ADMIN_SECRET || '')
    if (!temBearer && !sessao) {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 401 })
    }
  }

  const [projetos, equipe] = await Promise.all([listarProjetos(), lerEquipe()])
  const { vencidas, aVencer } = coletar(projetos, equipe)
  const total = vencidas.length + aVencer.length

  // ?dry=1 → só calcula e devolve, sem enviar (para testar).
  const dry = req.nextUrl.searchParams.get('dry')
  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      hoje: hojeISO_BRT(),
      totalProjetos: projetos.length,
      diagnostico: projetos.map((p) => ({
        nome: p.name,
        prazos: p.stages
          .filter((s) => s.due)
          .map((s) => ({ code: s.code, due: s.due, status: s.status, dias: diasAte(s.due as string) })),
      })),
      vencidas: vencidas.length,
      aVencer: aVencer.length,
      itens: { vencidas, aVencer },
    })
  }

  if (total === 0) {
    return NextResponse.json({ ok: true, enviado: false, motivo: 'nada vencido ou a vencer' })
  }

  const destino = process.env.DONO_EMAIL
  if (!destino) return NextResponse.json({ error: 'DONO_EMAIL não configurado' }, { status: 503 })

  const assunto = `Painel de Etapas — ${vencidas.length} atrasada(s), ${aVencer.length} a vencer`
  try {
    const resposta = await enviarEmail(destino, assunto, montarHtml(vencidas, aVencer))
    return NextResponse.json({ ok: true, enviado: true, para: destino, vencidas: vencidas.length, aVencer: aVencer.length, resend: resposta })
  } catch (e) {
    return NextResponse.json({ ok: false, enviado: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
