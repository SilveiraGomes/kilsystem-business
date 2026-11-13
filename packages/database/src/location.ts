import path from 'node:path';

import { PersistenceError } from './errors.js';

/** Extensões ignoradas pelo `.gitignore`, para que uma base mal colocada nunca seja versionada. */
export const DATABASE_FILE_EXTENSIONS = ['.sqlite', '.sqlite3', '.db'] as const;

export interface DatabaseLocationOptions {
  /** Directórios onde a base nunca pode ficar: código-fonte, repositório e artefactos de build. */
  readonly protectedDirectories: readonly string[];
}

const comparable = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

const isInside = (target: string, directory: string): boolean => {
  const relative = path.relative(comparable(directory), comparable(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * Valida a localização configurada para a base local. Não existe localização por omissão:
 * a localização definitiva depende da estratégia de instalação e de cópias de segurança.
 */
export const resolveDatabaseLocation = (
  configured: string | undefined,
  { protectedDirectories }: DatabaseLocationOptions,
): string => {
  if (configured === undefined || configured.trim() === '') {
    throw new PersistenceError('location-not-configured');
  }
  if (!path.isAbsolute(configured)) throw new PersistenceError('location-not-absolute');

  const location = path.resolve(configured);
  const extension = path.extname(location).toLowerCase();
  if (!DATABASE_FILE_EXTENSIONS.some((allowed) => allowed === extension)) {
    throw new PersistenceError('location-invalid-extension');
  }
  if (protectedDirectories.some((directory) => isInside(location, path.resolve(directory)))) {
    throw new PersistenceError('location-inside-protected-directory');
  }
  return location;
};
