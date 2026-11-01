// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ClipPicker } from './island/ClipPicker';
import { Island } from './island/Island';
import { WidgetView } from './island/Widget';
import { QuickSearch } from './screens/QuickSearch';
import { StoreProvider } from './state';
import { TerminalApp } from './terminal/TerminalApp';
import { HostView } from './screen/HostView';
import { ViewerView } from './screen/ViewerView';
import { GuideMini } from './guide';
import './styles/app.css';

// The small cue window beside an app (loads only in that window).
const CuePopup = lazy(() => import('./cues/CuePopup').then((m) => ({ default: m.CuePopup })));

// Wallpaper windows and the floating sound mixer load only their own code.
const WallpaperView = lazy(() => import('./wallpaper/WallpaperView').then((m) => ({ default: m.WallpaperView })));
const MixerPanel = lazy(() => import('./wallpaper/MixerPanel').then((m) => ({ default: m.MixerPanel })));

// The system monitor's small windows: the menu-bar pop-over, the tool launcher and single-tool windows.
const TrayPopover = lazy(() => import('./screens/monitor/TrayPopover').then((m) => ({ default: m.TrayPopover })));
const Launcher = lazy(() => import('./screens/monitor/Launcher').then((m) => ({ default: m.Launcher })));
const ToolWindow = lazy(() => import('./screens/monitor/ToolWindow').then((m) => ({ default: m.ToolWindow })));

// Remote Desktops' quick-connect window.
const RdcQuickWindow = lazy(() => import('./screens/RemoteDesktopQuick').then((m) => ({ default: m.RdcQuickWindow })));

// The listening pill (dictation and meetings): it also records, so it loads only its own code.
const VoiceHud = lazy(() => import('./voice/VoiceHud').then((m) => ({ default: m.VoiceHud })));

// One bundle, several windows: the main app, Quick Search, the Island, the clipboard picker and desktop widgets.
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'app';
document.documentElement.dataset.view = view;

createRoot(document.getElementById('root')!).render(
  // A wallpaper window needs none of the app's state: it starts nothing but its own drawing.
  view === 'wallpaper' ? <Suspense fallback={null}><WallpaperView /></Suspense> :
  <StrictMode>
    <StoreProvider>{view === 'sysmon-popover' ? <Suspense fallback={null}><TrayPopover /></Suspense> : view === 'launcher' ? <Suspense fallback={null}><Launcher /></Suspense> : view === 'tool' ? <Suspense fallback={null}><ToolWindow id={params.get('id') ?? ''} /></Suspense> : view === 'quick' ? <QuickSearch /> : view === 'rdc-quick' ? <Suspense fallback={null}><RdcQuickWindow /></Suspense> : view === 'island' ? <Island /> : view === 'clips' ? <ClipPicker /> : view === 'widget' ? <WidgetView /> : view === 'ambient' ? <Suspense fallback={null}><MixerPanel /></Suspense> : view === 'terminal' ? <TerminalApp mode={params.get('quick') ? 'quick' : 'window'} startCwd={params.get('cwd') ?? undefined} /> : view === 'voice' ? <Suspense fallback={null}><VoiceHud /></Suspense> : view === 'guide-mini' ? <GuideMini /> : view === 'screenhost' ? <HostView /> : view === 'screenviewer' ? <ViewerView /> : view === 'cue' ? <Suspense fallback={null}><CuePopup /></Suspense> : <App />}</StoreProvider>
  </StrictMode>,
);
