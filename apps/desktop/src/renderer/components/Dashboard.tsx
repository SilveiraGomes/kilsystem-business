import { ArrowRight, CalendarDays, CircleAlert, PackageCheck, ReceiptText } from 'lucide-react';

import type { NavigationId } from '../navigation';

interface DashboardProps {
  readonly onNavigate: (id: NavigationId) => void;
}

const illustrativeMetrics = [
  { label: 'Vendas hoje', meta: 'Indicador demonstrativo', value: 'Kz 0,00' },
  { label: 'Artigos monitorizados', meta: 'Sem catálogo configurado', value: '0' },
  { label: 'Documentos pendentes', meta: 'Sem movimentos registados', value: '0' },
] as const;

const dateFormatter = new Intl.DateTimeFormat('pt-AO', {
  day: '2-digit',
  month: 'long',
  weekday: 'long',
  year: 'numeric',
});

export const Dashboard = ({ onNavigate }: DashboardProps): React.JSX.Element => {
  const today = dateFormatter.format(new Date());
  const todayLabel = today.charAt(0).toUpperCase() + today.slice(1);

  return <div className="dashboard">
    <section className="dashboard-intro">
      <div>
        <span className="section-kicker">{todayLabel}</span>
        <h1>Bom trabalho, Administrador.</h1>
        <p>Esta é a visão operacional da unidade activa. Os valores apresentados são apenas demonstrativos e não representam movimentos comerciais.</p>
      </div>
      <button className="date-control" type="button">
        <CalendarDays aria-hidden="true" size={18} /> Hoje
      </button>
    </section>

    <section aria-labelledby="summary-title" className="summary-panel">
      <div className="summary-panel__heading">
        <div>
          <span className="section-kicker">Pulso da operação</span>
          <h2 id="summary-title">Resumo do dia</h2>
        </div>
        <span className="summary-panel__note">Dados de demonstração</span>
      </div>
      <div className="metric-grid">
        {illustrativeMetrics.map((metric) => (
          <article className="metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.meta}</small>
          </article>
        ))}
      </div>
    </section>

    <div className="dashboard-grid">
      <section aria-labelledby="activity-title" className="activity-panel panel">
        <div className="panel__heading">
          <div>
            <span className="section-kicker">Sequência recente</span>
            <h2 id="activity-title">Actividade da unidade</h2>
          </div>
          <button className="text-button" onClick={() => onNavigate('sales')} type="button">
            Abrir vendas <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="empty-activity">
          <span className="empty-activity__icon"><ReceiptText aria-hidden="true" size={24} /></span>
          <div>
            <strong>Ainda não existem movimentos</strong>
            <p>A actividade aparecerá aqui quando os módulos comerciais forem implementados.</p>
          </div>
        </div>
      </section>

      <aside aria-labelledby="attention-title" className="attention-panel panel">
        <div className="panel__heading">
          <div>
            <span className="section-kicker">Preparação</span>
            <h2 id="attention-title">Pontos de atenção</h2>
          </div>
          <CircleAlert aria-hidden="true" className="attention-icon" size={20} />
        </div>
        <ul className="attention-list">
          <li>
            <PackageCheck aria-hidden="true" size={18} />
            <span><strong>Catálogo por configurar</strong><small>O módulo de stock ainda não possui dados.</small></span>
          </li>
          <li>
            <span aria-hidden="true" className="attention-list__index">02</span>
            <span><strong>Utilizadores por definir</strong><small>A autenticação real será implementada noutra etapa.</small></span>
          </li>
        </ul>
      </aside>
    </div>
  </div>;
};
