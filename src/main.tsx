// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ClipPicker } from './island/ClipPicker';
import { Island } from './island/Island';
import { WidgetView } from './island/Widget';
import { QuickSearch } from './screens/QuickSearch';
import { StoreProvider } from './state';
import { TerminalApp } from './terminal/TerminalApp';
import './styles/app.css';

// One bundle, several windows: the main app, Quick Search, the Island, the clipboard picker and desktop widgets.
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'app';
document.documentElement.dataset.view = view;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>{view === 'quick' ? <QuickSearch /> : view === 'island' ? <Island /> : view === 'clips' ? <ClipPicker /> : view === 'widget' ? <WidgetView /> : view === 'terminal' ? <TerminalApp mode={params.get('quick') ? 'quick' : 'window'} startCwd={params.get('cwd') ?? undefined} /> : <App />}</StoreProvider>
  </StrictMode>,
);
