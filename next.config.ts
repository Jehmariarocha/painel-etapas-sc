import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Só para desenvolvimento: libera o celular na Wi-Fi local a carregar os
  // recursos do Next dev pelo IP da máquina. Sem isso, o Next 16 bloqueia o
  // acesso vindo de outro endereço e a página trava em "Carregando". Não tem
  // efeito na Vercel — lá o app é build de produção.
  allowedDevOrigins: ['192.168.0.105'],
}

export default nextConfig
