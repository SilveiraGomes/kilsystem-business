import { ArrowLeft, Construction } from 'lucide-react';

import type { NavigationItem } from '../navigation';

interface ModulePageProps {
  readonly item: NavigationItem;
}

export const ModulePage = ({ item }: ModulePageProps): React.JSX.Element => {
  const Icon = item.icon;
  return (
    <section aria-labelledby="module-title" className="module-page">
      <div className="module-page__header">
        <span className="module-page__icon"><Icon aria-hidden="true" size={26} strokeWidth={1.7} /></span>
        <div>
          <span className="section-kicker">Módulo</span>
          <h1 id="module-title">{item.label}</h1>
          <p>{item.description}</p>
        </div>
      </div>

      <div className="module-empty-state">
        <Construction aria-hidden="true" size={28} strokeWidth={1.6} />
        <strong>Área preparada para a próxima etapa</strong>
        <p>A navegação está funcional, mas este módulo ainda não possui dados, operações ou regras de negócio.</p>
        <span><ArrowLeft aria-hidden="true" size={15} /> Use o menu para continuar a explorar</span>
      </div>
    </section>
  );
};
