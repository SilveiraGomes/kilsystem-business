import { Bell, Building2, ChevronDown, Command, Search } from 'lucide-react';
import { useState } from 'react';

import { Dashboard } from './components/Dashboard';
import { ModulePage } from './components/ModulePage';
import { Sidebar } from './components/Sidebar';
import { getNavigationItem, type NavigationId } from './navigation';

export const App = (): React.JSX.Element => {
  const [activeView, setActiveView] = useState<NavigationId>('dashboard');
  const activeItem = getNavigationItem(activeView);

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__context">
            <span className="topbar__eyebrow">Área de trabalho</span>
            <strong>{activeItem.label}</strong>
          </div>

          <label className="search-box">
            <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            <span className="sr-only">Pesquisar no KIL Business</span>
            <input aria-label="Pesquisar no KIL Business" placeholder="Pesquisar" type="search" />
            <kbd>Ctrl K</kbd>
          </label>

          <div className="topbar__actions">
            <button aria-label="Notificações" className="icon-button" type="button">
              <Bell aria-hidden="true" size={19} />
              <span className="notification-dot" />
            </button>
            <button className="profile-button" type="button">
              <span className="profile-button__avatar">KS</span>
              <span className="profile-button__copy">
                <strong>Administrador</strong>
                <small>Ambiente demonstrativo</small>
              </span>
              <ChevronDown aria-hidden="true" size={16} />
            </button>
          </div>
        </header>

        <section aria-label="Contexto operacional" className="operations-strip">
          <div className="operations-strip__company">
            <Building2 aria-hidden="true" size={18} />
            <span>
              <small>Empresa activa</small>
              <strong>KIL Demonstração · Unidade Sede</strong>
            </span>
          </div>
          <div className="operations-strip__status">
            <span className="status-light" />
            Sistema local disponível
          </div>
          <div className="operations-strip__mode">
            <Command aria-hidden="true" size={16} />
            Sem dados reais
          </div>
        </section>

        <main className="content" id="main-content">
          {activeView === 'dashboard' ? (
            <Dashboard onNavigate={setActiveView} />
          ) : (
            <ModulePage item={activeItem} />
          )}
        </main>
      </div>
    </div>
  );
};
