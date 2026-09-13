import './styles.css';
import { Game } from './core/Game';
import { Capacitor } from '@capacitor/core';
const game=new Game();
void game.boot();
if(Capacitor.isNativePlatform()) {
  void import('@capacitor/app').then(({App})=>{
    void App.addListener('appStateChange',({isActive})=>{if(!isActive&&game.state==='playing')game.pause();game.input?.reset();});
    void App.addListener('backButton',()=>{if(game.ui.dialog.open)game.ui.close();else if(game.state==='playing')game.pause();else void App.minimizeApp();});
  });
}
