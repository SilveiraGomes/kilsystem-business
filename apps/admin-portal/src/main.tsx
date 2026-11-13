import React from 'react';
import ReactDOM from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz da aplicação não encontrado.');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <main>
      <h1>KIL Business Admin</h1>
      <p>Portal administrativo em preparação.</p>
    </main>
  </React.StrictMode>,
);
