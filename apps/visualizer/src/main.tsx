import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const scrollTimers = new WeakMap<Element, number>();
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    el.classList.add('scrolling');
    clearTimeout(scrollTimers.get(el));
    scrollTimers.set(
      el,
      window.setTimeout(() => {
        el.classList.remove('scrolling');
      }, 800),
    );
  },
  true,
);

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
