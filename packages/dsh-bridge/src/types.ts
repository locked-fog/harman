import type { JsonValue as SessionJsonValue } from '@deepseek-ai/dsh-session'

/**
 * DSH Session's lossless JSON boundary, owned locally so the external Typert
 * analyzer can generate a codec for the recursive root. The bidirectional
 * assertion below makes divergence from the official Session contract a build
 * error while keeping the public Bridge `./types` entry point stable.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type SessionJsonValueContract = [JsonValue] extends [SessionJsonValue]
  ? [SessionJsonValue] extends [JsonValue] ? true : never
  : never

const sessionJsonValueContract: SessionJsonValueContract = true
void sessionJsonValueContract
