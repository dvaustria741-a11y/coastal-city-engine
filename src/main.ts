import './styles.css';
import { Game } from './core/Game';
import { Capacitor } from '@capacitor/core';
// Best-effort landscape lock for browser/PWA play — the packaged Android app is already locked
// via AndroidManifest's android:screenOrientation, this just matches that in the browser too.
void (async () => {
  try {
    const orientation = (screen as any).orientation;
    if (orientation?.lock) await orientation.lock('landscape');
  } catch {
    /* not supported/allowed outside a fullscreen or installed-PWA context — safe to ignore */
  }
})();
const game=new Game();
void game.boot();
if(Capacitor.isNativePlatform()) {
  void import('@capacitor/app').then(({App})=>{
    void App.addListener('appStateChange',({isActive})=>{if(!isActive&&game.state==='playing')game.pause();game.input?.reset();});
    void App.addListener('backButton',()=>{if(game.ui.dialog.open)game.ui.close();else if(game.state==='playing')game.pause();else void App.minimizeApp();});
  });
}
