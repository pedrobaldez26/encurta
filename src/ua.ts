// Classificação bem simples. Não tenta ser completa, só separar o que importa em um gráfico.
export function browserFamily(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'Desconhecido';
  if (/bot|crawler|spider|preview|facebookexternalhit|slackbot/i.test(ua)) return 'Bot';
  if (/curl|wget|httpie|python-requests/i.test(ua)) return 'Linha de comando';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Outro';
}

export function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname;
  } catch {
    return null;
  }
}
