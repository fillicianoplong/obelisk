import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../shared/app-info.js';
import { App } from './App.js';
import './styles.css';

document.title = APP_NAME;

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Root element #root is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
