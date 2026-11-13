import Fastify, { type FastifyInstance } from 'fastify';

export const createLocalApi = (): FastifyInstance =>
  Fastify({ logger: true, trustProxy: false });
