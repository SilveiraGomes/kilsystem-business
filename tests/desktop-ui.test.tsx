// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../apps/desktop/src/renderer/App';

describe('KIL Business desktop interface', () => {
  it('renders the demonstrative dashboard and all navigation destinations', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Bom trabalho, Administrador.' })).toBeVisible();
    expect(screen.getByText('Sem dados reais')).toBeVisible();

    const destinations = [
      'Empresas',
      'Estabelecimentos',
      'Utilizadores',
      'Vendas',
      'Stock',
      'Contabilidade',
      'Configurações',
    ];

    for (const destination of destinations) {
      expect(screen.getByRole('button', { name: destination })).toBeVisible();
    }
  });

  it('navigates to a module without presenting unimplemented operations', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Empresas' }));

    expect(screen.getByRole('heading', { name: 'Empresas' })).toBeVisible();
    expect(screen.getByText('Área preparada para a próxima etapa')).toBeVisible();
    expect(screen.getByText(/ainda não possui dados, operações ou regras de negócio/i)).toBeVisible();
  });
});
