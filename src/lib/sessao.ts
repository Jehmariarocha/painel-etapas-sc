import { NextResponse, type NextRequest } from 'next/server'

/**
 * Sessão do escritório — **login com Google**, igual à estimadora. Não há mais
 * senha: cada pessoa entra com a própria conta do domínio do escritório.
 *
 * O cookie leva `email.papel.validade.assinatura`. A assinatura é HMAC-SHA256
 * com `ADMIN_SECRET`, então o conteúdo é legível mas **não é forjável**: quem
 * mudar o papel de `equipe` para `dona` na mão quebra a assinatura.
 *
 * Usa Web Crypto (não `node:crypto`) de propósito — o `proxy.ts` roda no
 * runtime de borda, onde `node:crypto` não existe.
 */

export type Papel = 'dona' | 'equipe'

export interface Sessao {
  email: string
  papel: Papel
  /** Quando expira, em segundos desde 1970. */
  expira: number
}

/** Só e-mails deste domínio entram. */
export const DOMINIO_DA_EQUIPE = '1comodo.online'

export const COOKIE_SESSAO = 'sessao'
export const TRINTA_DIAS = 60 * 60 * 24 * 30

const DIAS = 30
const codificador = new TextEncoder()

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const x of b) bin += String.fromCharCode(x)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function assinar(corpo: string, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw', codificador.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return base64url(await crypto.subtle.sign('HMAC', chave, codificador.encode(corpo)))
}

/** Comparação sem vazar onde as assinaturas passaram a diferir. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

export async function criarCookieSessao(
  email: string, papel: Papel, segredo: string, agoraMs = Date.now(),
): Promise<string> {
  const expira = Math.floor(agoraMs / 1000) + DIAS * 24 * 3600
  const corpo = `${base64url(codificador.encode(email))}.${papel}.${expira}`
  return `${corpo}.${await assinar(corpo, segredo)}`
}

/** Devolve a sessão, ou `null` se o cookie for inválido, forjado ou vencido. */
export async function lerCookieSessao(
  cookie: string | undefined, segredo: string, agoraMs = Date.now(),
): Promise<Sessao | null> {
  if (!cookie || !segredo) return null
  const partes = cookie.split('.')
  if (partes.length !== 4) return null
  const [emailB64, papel, expiraStr, assinatura] = partes

  if (papel !== 'dona' && papel !== 'equipe') return null
  const expira = Number(expiraStr)
  if (!Number.isFinite(expira)) return null

  const esperada = await assinar(`${emailB64}.${papel}.${expiraStr}`, segredo)
  if (!iguais(assinatura, esperada)) return null

  // Só depois de conferir a assinatura: antes disso o conteúdo não vale nada.
  if (expira * 1000 <= agoraMs) return null

  let email: string
  try {
    email = atob(emailB64.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
  return { email, papel, expira }
}

/**
 * Quem pode entrar, e com qual papel. A dona é uma só (`DONO_EMAIL`); qualquer
 * outra conta do domínio do escritório entra como equipe. Fora do domínio, não.
 */
export function papelDoEmail(email: string, emailDaDona: string | undefined): Papel | null {
  const e = email.trim().toLowerCase()
  if (!e.includes('@')) return null
  if (emailDaDona && e === emailDaDona.trim().toLowerCase()) return 'dona'
  return e.endsWith(`@${DOMINIO_DA_EQUIPE}`) ? 'equipe' : null
}

/** Este navegador é do escritório? Confere a assinatura do cookie de sessão. */
export async function ehAdmin(req: NextRequest): Promise<boolean> {
  const segredo = process.env.ADMIN_SECRET
  if (!segredo) return false
  return (await lerCookieSessao(req.cookies.get(COOKIE_SESSAO)?.value, segredo)) !== null
}

/**
 * **Segunda trava**, chamada no começo de cada rota do escritório. A primeira
 * é o `proxy.ts`; esta existe porque uma camada só abre tudo junto se falhar.
 *
 *     const recusa = await exigirAdmin(req); if (recusa) return recusa
 */
export async function exigirAdmin(req: NextRequest): Promise<NextResponse | null> {
  return (await ehAdmin(req)) ? null : NextResponse.json({ error: 'Sem permissão' }, { status: 401 })
}
