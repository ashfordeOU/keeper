// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Island } from './island/Island';
import { QuickSearch } from './screens/QuickSearch';
import { StoreProvider } from './state';
import './styles/app.css';

// One bundle, three windows: the main app, the Quick Search panel and the Island.
const view = new URLSearchParams(location.search).get('view') ?? 'app';
document.documentElement.dataset.view = view;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>{view === 'quick' ? <QuickSearch /> : view === 'island' ? <Island /> : <App />}</StoreProvider>
  </StrictMode>,
);
