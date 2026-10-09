/** Web 与 Java 使用同一配置；仅转发当前环境的会话，其他环境的 Cookie 留在浏览器。 */
export function selectSessionCookie(cookieHeader: string | null): string | undefined {
  const name = process.env.SESSION_COOKIE_NAME ?? 'dip3_session';
  return cookieHeader?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
}
