/**
 * Utilitaires de test (backend). Non embarqués dans le bundle (tsup n'entrée que
 * server.ts). Fournissent des doubles minimalistes de FastifyReply/Request pour
 * tester les mappeurs d'erreurs sans passer par la couche HTTP.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

/** Reply Fastify capturée : enregistre code, payload et en-têtes. */
export interface CapturedReply {
  reply: FastifyReply;
  statusCode?: number;
  payload?: unknown;
  headers: Record<string, string>;
}

/** Construit une reply Fastify factice qui enregistre ce qu'on lui envoie. */
export function makeReply(): CapturedReply {
  const captured: CapturedReply = {
    reply: undefined as unknown as FastifyReply,
    headers: {},
  };
  const reply = {
    code(status: number): FastifyReply {
      captured.statusCode = status;
      return reply;
    },
    send(payload: unknown): FastifyReply {
      captured.payload = payload;
      return reply;
    },
    header(name: string, value: string): FastifyReply {
      captured.headers[name.toLowerCase()] = value;
      return reply;
    },
  } as unknown as FastifyReply;
  captured.reply = reply;
  return captured;
}

/** Request Fastify factice : seul `.log` est sollicité par les mappeurs d'erreurs. */
export function makeRequest(): FastifyRequest {
  const noop = (): void => {};
  return {
    log: { error: noop, warn: noop, info: noop, debug: noop, fatal: noop, trace: noop },
  } as unknown as FastifyRequest;
}
