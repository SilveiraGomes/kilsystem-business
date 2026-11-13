import Fastify, { type FastifyInstance } from 'fastify';

export const createCentralApi = (): FastifyInstance =>
  Fastify({ logger: true, trustProxy: false });
