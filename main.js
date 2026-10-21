

const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1000,
    minHeight: 650,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Electron no muestra el aviso "¿seguro que quieres salir?" de la página (beforeunload) y,
  // sin esto, la ventana parecería trabada al cerrarla con productos en el carrito.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Seguir aquí', 'Salir'],
      defaultId: 0,
      cancelId: 0,
      title: 'Carrito sin terminar',
      message: 'Tienes productos en el carrito. ¿Seguro que quieres salir?'
    });
    if (choice === 1) event.preventDefault(); // ignora el aviso de la página y deja cerrar
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('Error al cargar la aplicación:', code, description);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
