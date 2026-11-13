import type { NavigationId } from '../navigation';
import { navigationItems } from '../navigation';

interface SidebarProps {
  readonly activeView: NavigationId;
  readonly onNavigate: (id: NavigationId) => void;
}

export const Sidebar = ({ activeView, onNavigate }: SidebarProps): React.JSX.Element => (
  <aside className="sidebar">
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <div className="brand">
      <span aria-hidden="true" className="brand__mark">K</span>
      <span className="brand__copy">
        <strong>KIL Business</strong>
        <small>Gestão que acompanha</small>
      </span>
    </div>

    <nav aria-label="Navegação principal" className="primary-navigation">
      <span className="navigation-label">Navegação</span>
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeView;
        return (
          <button
            aria-current={active ? 'page' : undefined}
            className="navigation-item"
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>{item.label}</span>
            {active ? <span aria-hidden="true" className="navigation-item__marker" /> : null}
          </button>
        );
      })}
    </nav>

    <div className="sidebar__footer">
      <span className="sidebar__edition">Edição local</span>
      <small>Versão demonstrativa · E1.02</small>
    </div>
  </aside>
);
