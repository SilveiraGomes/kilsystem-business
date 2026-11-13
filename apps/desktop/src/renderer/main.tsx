import React from 'react';
import ReactDOM from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz da aplicação não encontrado.');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <main>
      <h1>KIL Business</h1>
      <p>Fundação tecnológica inicial.</p>
    </main>
  </React.StrictMode>,
);
