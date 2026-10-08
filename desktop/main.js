// exe 化 (Electron) のアプリの入口。ゲームの game/index.html (タイトル画面) を専用のウィンドウで開く。
// 組み立ては desktop/build.js、exe は GitHub Actions が @electron/packager で作る (DESIGN.md の「配布」)
const {app, BrowserWindow, Menu} = require('electron');
const path = require('node:path');

// 効果音・BGM を、クリックを待たずに鳴らせるようにする (ブラウザでは最初の操作まで鳴らない)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow(){
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1280, minHeight: 720,
    title: 'BATTLESHIP', backgroundColor: '#03060f', autoHideMenuBar: true,
    webPreferences: {contextIsolation: true, sandbox: true}
  });
  // F11 で全画面の切り替え
  win.webContents.on('before-input-event', (e, input) => {
    if(input.type === 'keyDown' && input.key === 'F11'){
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.loadFile(path.join(__dirname, 'game', 'index.html'));
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
