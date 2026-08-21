/**
 * Static-analysis contract for an external DSH package build.
 *
 * The official Typert generator recognizes protocol symbols by their owning
 * workspace module declaration. A Bridge build consumes the published
 * protocol from node_modules instead, so this checked-in declaration preserves
 * that ownership marker without inventing a runtime package or a build-time
 * generated facade. Runtime imports continue to resolve to the official
 * `@deepseek-ai/dsh-typert-protocol` package.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  import { Service, type Context } from '@deepseek-ai/cordis'

  declare const LOOKUP_HOST: unique symbol
  declare const LOOKUP_WIRE: unique symbol

  export interface TypertLookup<Host, Wire> {
    readonly [LOOKUP_HOST]: Host
    readonly [LOOKUP_WIRE]: Wire
  }

  export interface TypertContext<Wire> {
    readonly __harmanTypertContextWire: Wire
  }

  export abstract class TypertRemoteService<out T = never> extends Service<T> {
    protected constructor(ctx: Context, serviceKey: string, options?: { namespace?: string })
  }

  export const Remote: typeof import('@deepseek-ai/dsh-typert-protocol').Remote
  export const RemoteScope: typeof import('@deepseek-ai/dsh-typert-protocol').RemoteScope
  export const bindTypertRemote: typeof import('@deepseek-ai/dsh-typert-protocol').bindTypertRemote
}

export {}
