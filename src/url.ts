export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Só aceita http(s), sem usuário/senha embutidos e sem apontar para o próprio
 * encurtador (evita laço de redirecionamento).
 */
export function checkTargetUrl(raw: string, ownHost?: string): UrlCheck {
  if (raw.length > 2048) return { ok: false, reason: 'url_too_long' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials_in_url' };
  }
  if (ownHost && parsed.host.toLowerCase() === ownHost.toLowerCase()) {
    return { ok: false, reason: 'points_to_self' };
  }
  return { ok: true, url: parsed.toString() };
}
