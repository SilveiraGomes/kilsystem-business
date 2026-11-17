import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { PersistenceError } from './errors.js';

/**
 * Extensões ignoradas pelo `.gitignore`, para que uma base mal colocada nunca seja versionada.
 * Congelada em execução (E1.07-D1-H): a validação da localização consulta esta lista.
 */
export const DATABASE_FILE_EXTENSIONS = Object.freeze(['.sqlite', '.sqlite3', '.db'] as const);

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

// Caminhos UNC (`\\servidor\partilha`), de dispositivo (`\\.\`) e de caminho longo (`\\?\`): a base
// operacional só é suportada em disco local (E1.07-X); o SQLite desaconselha bloqueios em rede.
const isNetworkOrDevicePath = (value: string): boolean => /^[\\/]{2}/.test(value);

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
  if (isNetworkOrDevicePath(configured)) throw new PersistenceError('location-network-path');

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

const withAccessCheck = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new PersistenceError('location-access-denied', { cause: error });
    throw error;
  }
};

const canonical = (value: string): string => {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
};

/**
 * Identifica a base operacional efectiva (E1.07-X), depois de `resolveDatabaseLocation`:
 * - resolve maiúsculas, separadores, componentes redundantes, ligações simbólicas e *junctions*
 *   para o caminho final do sistema de ficheiros, para que o ficheiro WAL tenha sempre o mesmo nome;
 * - recusa ficheiros com várias ligações físicas (*hard links*): cada nome teria o seu WAL;
 * - recusa caminhos finais em rede ou de dispositivo e repete as verificações de extensão e de
 *   directórios protegidos sobre o caminho final.
 * O bloqueio exclusivo é do ficheiro, e não do nome: aliases concorrentes são recusados pelo
 * sistema operativo; esta identificação impede o uso sequencial por nomes diferentes.
 */
export const resolveDatabaseIdentity = (location: string, { protectedDirectories }: DatabaseLocationOptions): string => {
  let resolvedDirectory: string;
  try {
    resolvedDirectory = realpathSync.native(path.dirname(location));
  } catch {
    // Directório inexistente: não há ficheiro a identificar; a abertura falha sem o criar.
    return location;
  }

  let identity = path.join(resolvedDirectory, path.basename(location));
  if (existsSync(identity)) {
    identity = withAccessCheck(() => realpathSync.native(identity));
    const stats = statSync(identity);
    if (!stats.isFile()) throw new PersistenceError('location-not-a-file');
    if (stats.nlink > 1) throw new PersistenceError('location-hard-linked');
    // Sem leitura e escrita, o SQLite abriria só para leitura e falharia mais tarde com um erro de
    // E/S ambíguo; a falta de permissão é identificada aqui (em Windows, inclui o atributo só de leitura).
    withAccessCheck(() => {
      accessSync(identity, constants.R_OK | constants.W_OK);
    });
  }
  if (isNetworkOrDevicePath(identity)) throw new PersistenceError('location-network-path');
  return resolveDatabaseLocation(identity, {
    protectedDirectories: [...protectedDirectories, ...protectedDirectories.map(canonical)],
  });
};
