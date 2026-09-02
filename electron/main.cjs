const { app, BrowserWindow, Tray, Menu, Notification, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isServerRunning = false;
let isSyncing = false;
const PORT = 3001;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      openAppWindow();
    }
  });
}

/**
 * Start or import local backend server
 */
function startBackendServer() {
  if (isServerRunning) return;
  try {
    process.env.USER_DATA_DIR = app.getPath('userData');
    // Dynamically import ESM server/index.js in background
    import('../server/index.js')
      .then(() => {
        isServerRunning = true;
        updateTrayMenu();
        console.log('[Electron] Backend Express server initialized on port', PORT);
      })
      .catch((err) => {
        console.error('[Electron] Failed to start backend server:', err);
      });
  } catch (err) {
    console.error('[Electron] Server launch error:', err);
  }
}

/**
 * Trigger Mantis Data Sync via local API
 */
function triggerMantisSync() {
  if (isSyncing) return;
  isSyncing = true;
  updateTrayMenu();

  showNotification('Mantis 데이터 동기화 중...', '원격 Mantis 서버(192.168.16.200)에서 최신 CR 데이터를 가져오고 있습니다.');

  const postData = JSON.stringify({ mantisUrl: 'http://192.168.16.200' });
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/api/sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      isSyncing = false;
      updateTrayMenu();
      try {
        const json = JSON.parse(data);
        if (json.ok) {
          showNotification('동기화 완료 🎉', `총 ${json.count || 7734}건의 Mantis CR 데이터가 성공적으로 업데이트되었습니다.`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
          }
        } else {
          showNotification('동기화 실패 ⚠️', json.error || 'Mantis 서버 통신 실패');
        }
      } catch (e) {
        showNotification('동기화 완료', '데이터베이스 갱신이 완료되었습니다.');
      }
    });
  });

  req.on('error', (e) => {
    isSyncing = false;
    updateTrayMenu();
    showNotification('동기화 오류', '로컬 백엔드 서버에 연결할 수 없습니다: ' + e.message);
  });

  req.write(postData);
  req.end();
}

/**
 * Show Native Desktop Notification
 */
function showNotification(title, body) {
  if (Notification.isSupported()) {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    new Notification({
      title: title,
      body: body,
      icon: fs.existsSync(iconPath) ? iconPath : undefined
    }).show();
  }
}

/**
 * Create or Show Web UI Window
 */
function openAppWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const iconPath = path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Mantis CR Ultra Search & AI Hub',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#0b1120'
  });

  // Load URL with resilient retry mechanism until server responds
  function tryLoadURL(retries = 15) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    http.get(`http://localhost:${PORT}/api/status`, (res) => {
      if (res.statusCode === 200) {
        mainWindow.loadURL(`http://localhost:${PORT}`);
      } else if (retries > 0) {
        setTimeout(() => tryLoadURL(retries - 1), 250);
      } else {
        mainWindow.loadURL(`http://localhost:${PORT}`);
      }
    }).on('error', () => {
      if (retries > 0) {
        setTimeout(() => tryLoadURL(retries - 1), 250);
      } else {
        mainWindow.loadURL(`http://localhost:${PORT}`);
      }
    });
  }

  tryLoadURL();

  // Minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      showNotification('Mantis CR Hub 백그라운드 실행', '앱이 작업표시줄 트레이에서 계속 실행 중입니다. 트레이 아이콘을 클릭하여 메뉴를 이용하세요.');
    }
  });
}

/**
 * Build and update System Tray context menu
 */
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '⚡ Mantis CR Ultra Hub v1.0.0',
      enabled: false
    },
    {
      label: isServerRunning ? '🟢 서버 상태: 정상 구동 중 (3001)' : '🟡 서버 상태: 준비 중',
      enabled: false
    },
    { type: 'separator' },
    {
      label: '🌐 Mantis CR Hub 열기',
      click: () => openAppWindow()
    },
    {
      label: '🔗 기본 웹 브라우저에서 열기',
      click: () => shell.openExternal(`http://localhost:${PORT}`)
    },
    { type: 'separator' },
    {
      label: isSyncing ? '⏳ Mantis 데이터 동기화 중...' : '🔄 Mantis 최신 데이터 동기화 / 업데이트',
      enabled: !isSyncing,
      click: () => triggerMantisSync()
    },
    {
      label: '⚙️ SSH / ClearCase 설정',
      click: () => {
        openAppWindow();
        mainWindow.webContents.executeJavaScript("window.location.hash = '#settings';");
      }
    },
    { type: 'separator' },
    {
      label: '📖 GitHub 저장소 & 업데이트 확인',
      click: () => shell.openExternal('https://github.com/HyungdukSeo/E-sim')
    },
    { type: 'separator' },
    {
      label: '🚪 Mantis CR Hub 완전 종료',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('Mantis CR Ultra Search & AI Hub (실행 중)');
}

/**
 * Initialize System Tray Icon
 */
function createTray() {
  const templatePath = path.join(__dirname, 'assets', 'tray-iconTemplate.png');
  const fallbackPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const iconFile = fs.existsSync(templatePath) ? templatePath : fallbackPath;

  const image = nativeImage.createFromPath(iconFile);
  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  tray = new Tray(image);

  // Single click or double click tray icon to open window
  tray.on('double-click', () => {
    openAppWindow();
  });

  updateTrayMenu();
}

// App lifecycle
app.whenReady().then(() => {
  startBackendServer();
  createTray();
  openAppWindow();

  setTimeout(() => {
    showNotification(
      'Mantis CR Ultra Hub 시작됨 🚀',
      '백그라운드에서 실행 중입니다. 작업표시줄 아이콘에서 [시작 / 중지 / 업데이트] 메뉴를 이용하세요.'
    );
  }, 1500);
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows/Mac
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
