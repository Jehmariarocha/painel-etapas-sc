import { NextRequest, NextResponse } from 'next/server'
import { ehSandbox } from '@/lib/chaves'
import { lerCookieSessao, COOKIE_SESSAO } from '@/lib/sessao'
import { tgEnviar, tgGetUpdates } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Teste da Fase 3 (Telegram):
 *  - GET /cron/tg-teste            → lista os chat_id de quem já falou com o bot.
 *  - GET /cron/tg-teste?chat=123   → envia uma mensagem de teste para esse chat.
 *
 * Só a dona logada dispara (no local libera). Fica fora de /api (igual ao alerta).
 */
export async function GET(req: NextRequest) {
  if (!ehSandbox()) {
    const sessao = await lerCookieSessao(req.cookies.get(COOKIE_SESSAO)?.value, process.env.ADMIN_SECRET || '')
    if (!sessao || sessao.papel !== 'dona') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 401 })
    }
  }
  try {
    const chat = req.nextUrl.searchParams.get('chat')
    if (!chat) {
      const chats = await tgGetUpdates()
      return NextResponse.json({
        ok: true,
        dica: 'Mande uma mensagem pro seu bot no Telegram, recarregue aqui, ache seu chat_id abaixo e chame de novo com ?chat=SEU_ID',
        chats,
      })
    }
    await tgEnviar(chat, '✅ <b>Painel de Etapas</b> — se você recebeu isto, o aviso no Telegram está funcionando! 🎉')
    return NextResponse.json({ ok: true, enviado: true, para: chat })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
