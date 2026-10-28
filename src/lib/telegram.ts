import 'server-only'

/**
 * Envio pelo Telegram Bot API. Usa TELEGRAM_BOT_TOKEN (gerado pelo @BotFather).
 * Texto livre funciona sempre (ao contrário do WhatsApp), sem template nem
 * aprovação. Cada pessoa que quiser receber manda uma mensagem pro bot uma vez;
 * daí pegamos o `chat_id` dela (ver `getUpdates`).
 */

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN ausente')
  return t
}
const API = () => `https://api.telegram.org/bot${token()}`

/** Envia uma mensagem (HTML) para um chat. */
export async function tgEnviar(chatId: string | number, texto: string) {
  const r = await fetch(`${API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  const d = await r.json()
  if (!d.ok) throw new Error(`Telegram ${r.status}: ${JSON.stringify(d)}`)
  return d
}

/** Mensagens recentes recebidas pelo bot — serve pra descobrir os chat_id. */
export async function tgGetUpdates(): Promise<Array<{ id: number; nome: string }>> {
  const r = await fetch(`${API()}/getUpdates`)
  const d = await r.json()
  if (!d.ok) throw new Error(`Telegram ${r.status}: ${JSON.stringify(d)}`)
  const vistos = new Map<number, string>()
  for (const u of d.result || []) {
    const c = u.message?.chat
    if (c) vistos.set(c.id, `${c.first_name || ''} ${c.last_name || ''}${c.title ? ` [grupo: ${c.title}]` : ''}${c.username ? ` (@${c.username})` : ''}`.trim())
  }
  return [...vistos].map(([id, nome]) => ({ id, nome }))
}
