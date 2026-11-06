import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { BottomNav } from './components/BottomNav';
import { MiniPlayer } from './components/MiniPlayer';
import { PlayerSheet } from './components/PlayerSheet';
import { Toasts } from './components/Toasts';
import { TrackMenu } from './components/TrackMenu';
import { Channel } from './pages/Channel';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { Login } from './pages/Login';
import { Playlist } from './pages/Playlist';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';

export function App() {
  const { pathname } = useLocation();
  // Any 401 sends us to /login (see api.ts); check once on start.
  useEffect(() => {
    if (pathname !== '/login') api.get('/api/auth/me').catch(() => undefined);
  }, [pathname === '/login']);
  if (pathname === '/login') {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }
  return (
    <div className="min-h-dvh">
      {/* Room for the fixed mini player + nav + home indicator */}
      <main className="pb-[calc(9rem+env(safe-area-inset-bottom))] pl-safe pr-safe">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/channel/:id" element={<Channel />} />
          <Route path="/playlist/:id" element={<Playlist />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 pb-safe pl-safe pr-safe">
        <MiniPlayer />
        <BottomNav />
      </div>
      <PlayerSheet />
      <TrackMenu />
      <Toasts />
    </div>
  );
}
