import { parseOneOf } from './validation.js';

/**
 * Sectores comerciais suportados (D-018). Um novo sector é acrescentado a esta lista;
 * o compilador exige então a respectiva designação em `SECTOR_LABELS`. Congelada em execução
 * (E1.07-D1-H, PD-64): só uma alteração do código, com migração, acrescenta sectores.
 */
export const SECTOR_TYPES = Object.freeze(['PHARMACY', 'SUPERMARKET', 'FUEL_STATION', 'RESTAURANT'] as const);

export type SectorType = (typeof SECTOR_TYPES)[number];

export const SECTOR_LABELS: Readonly<Record<SectorType, string>> = Object.freeze({
  PHARMACY: 'Farmácia',
  SUPERMARKET: 'Supermercado',
  FUEL_STATION: 'Posto de combustível',
  RESTAURANT: 'Restauração',
});

export const isSectorType = (value: unknown): value is SectorType =>
  SECTOR_TYPES.some((sector) => sector === value);

export const parseSectorType = (value: unknown, field = 'sectorType'): SectorType =>
  parseOneOf(value, SECTOR_TYPES, field);
