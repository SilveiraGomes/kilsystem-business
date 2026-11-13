import {
  BarChart3,
  Boxes,
  Building2,
  Calculator,
  LayoutDashboard,
  MapPin,
  Settings,
  ShoppingBag,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavigationId =
  | 'dashboard'
  | 'companies'
  | 'establishments'
  | 'users'
  | 'sales'
  | 'stock'
  | 'accounting'
  | 'settings';

export interface NavigationItem {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly id: NavigationId;
  readonly label: string;
}

export const navigationItems: readonly NavigationItem[] = [
  { description: 'Visão geral da operação demonstrativa.', icon: LayoutDashboard, id: 'dashboard', label: 'Visão geral' },
  { description: 'Estrutura empresarial e enquadramento organizacional.', icon: Building2, id: 'companies', label: 'Empresas' },
  { description: 'Unidades, lojas e locais de operação.', icon: MapPin, id: 'establishments', label: 'Estabelecimentos' },
  { description: 'Pessoas, funções e permissões futuras.', icon: Users, id: 'users', label: 'Utilizadores' },
  { description: 'Área reservada à futura operação comercial.', icon: ShoppingBag, id: 'sales', label: 'Vendas' },
  { description: 'Área reservada ao futuro controlo de existências.', icon: Boxes, id: 'stock', label: 'Stock' },
  { description: 'Área reservada ao futuro ciclo contabilístico.', icon: Calculator, id: 'accounting', label: 'Contabilidade' },
  { description: 'Preferências da aplicação e parâmetros futuros.', icon: Settings, id: 'settings', label: 'Configurações' },
] as const;

export const getNavigationItem = (id: NavigationId): NavigationItem =>
  navigationItems.find((candidate) => candidate.id === id) ?? {
    description: 'Área de trabalho do KIL Business.',
    icon: BarChart3,
    id: 'dashboard',
    label: 'Visão geral',
  };
