/**
 * Helpers for resolving Aeon Container API endpoints across host apps.
 *
 * Supported base inputs:
 * - https://halo.place                  -> https://halo.place/api/container
 * - https://halo.place/api/container    -> unchanged
 * - https://.../v1/aeon-container       -> unchanged
 */

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveContainerApiBase(apiUrl: string): string {
  const trimmed = stripTrailingSlashes(apiUrl || '');
  if (!trimmed) return '';

  if (
    trimmed.endsWith('/api/container') ||
    trimmed.endsWith('/v1/aeon-container')
  ) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === '' || parsed.pathname === '/') {
      return `${trimmed}/api/container`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function joinContainerApiPath(base: string, path: string): string {
  const normalizedBase = resolveContainerApiBase(base);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (!normalizedBase) return normalizedPath;

  if (
    normalizedBase.endsWith('/api/container') ||
    normalizedBase.endsWith('/v1/aeon-container')
  ) {
    return `${normalizedBase}${normalizedPath}`;
  }

  return `${normalizedBase}/api/container${normalizedPath}`;
}
