import { existsSync } from 'node:fs';
import path from 'node:path';

const findAncestorWith = (start: string, marker: string): string | undefined => {
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, marker))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/**
 * Directórios onde a base local nunca pode ficar: o pacote do serviço e, em desenvolvimento,
 * a raiz do monorepositório (que contém o código e todos os artefactos de build).
 */
export const resolveProtectedDirectories = (codeDirectory: string): readonly string[] => {
  const packageRoot = findAncestorWith(codeDirectory, 'package.json') ?? path.resolve(codeDirectory);
  const workspaceRoot = findAncestorWith(packageRoot, 'pnpm-workspace.yaml');
  return workspaceRoot === undefined ? [packageRoot] : [packageRoot, workspaceRoot];
};
