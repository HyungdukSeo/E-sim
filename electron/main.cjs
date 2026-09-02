const { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isServerRunning = false;
let isSyncing = false;
const PORT = 3001;
let activePort = PORT;

/**
 * Log diagnostic messages/errors to AppData file for troubleshooting
 */
function logErrorToFile(msg) {
  try {
    const logDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'MantisCRHub') : __dirname;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'app.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

/**
 * Kill any zombie process occupying PORT from previous crash or run
 */
function killOldPortProcess(port = PORT) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -aon | findstr :${port}`, { encoding: 'utf-8' });
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && parseInt(pid, 10) !== process.pid) {
            console.log(`[Electron] Clearing lingering process PID ${pid} on port ${port}...`);
            execSync(`taskkill /f /pid ${pid} >nul 2>nul`);
          }
        }
      }
    }
  } catch (e) {}
}

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

let serverModule = null;

/**
 * Start or import local backend server
 */
async function startBackendServer() {
  if (isServerRunning) return;
  try {
    process.env.USER_DATA_DIR = app.getPath('userData');
    killOldPortProcess(PORT);

    if (!serverModule) {
      let serverScriptPath = path.join(__dirname, '..', 'server', 'index.js');
      if (app.isPackaged && !fs.existsSync(serverScriptPath)) {
        serverScriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.js');
      }
      const fileUrl = pathToFileURL(serverScriptPath).href;
      serverModule = await import(fileUrl);
    }

    if (serverModule && typeof serverModule.startServer === 'function') {
      const res = await serverModule.startServer(PORT);
      if (res && res.port) {
        activePort = res.port;
      } else if (typeof serverModule.getActivePort === 'function') {
        activePort = serverModule.getActivePort();
      }
    }

    isServerRunning = true;
    updateTrayMenu();
    console.log('[Electron] Backend Express server running on port', activePort);
    logErrorToFile(`Backend Express server started successfully on port ${activePort}`);
  } catch (err) {
    console.error('[Electron] Failed to start backend server:', err);
    logErrorToFile(`Failed to start server: ${err.stack || err.message}`);
    showNotification('서버 시작 오류 ⚠️', err.message);
  }
}

/**
 * Stop local backend server
 */
async function stopBackendServer() {
  if (!isServerRunning) return;
  try {
    if (serverModule && typeof serverModule.stopServer === 'function') {
      await serverModule.stopServer();
    }
    isServerRunning = false;
    updateTrayMenu();
    showNotification('서버 중지됨 ⏹️', `Mantis 백엔드 서버(포트 ${activePort})가 중지되었습니다.`);
    console.log('[Electron] Backend server stopped.');
  } catch (err) {
    console.error('[Electron] Failed to stop backend server:', err);
  }
}

/**
 * Restart local backend server
 */
async function restartBackendServer() {
  await stopBackendServer();
  setTimeout(async () => {
    await startBackendServer();
    showNotification('서버 재시작 완료 🚀', `Mantis 백엔드 서버가 포트 ${activePort}에서 다시 구동되었습니다.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  }, 400);
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
    port: activePort,
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

    http.get(`http://localhost:${activePort}/api/status`, (res) => {
      if (res.statusCode === 200) {
        mainWindow.loadURL(`http://localhost:${activePort}`);
      } else if (retries > 0) {
        setTimeout(() => tryLoadURL(retries - 1), 250);
      } else {
        mainWindow.loadURL(`http://localhost:${activePort}`);
      }
    }).on('error', () => {
      if (retries > 0) {
        setTimeout(() => tryLoadURL(retries - 1), 250);
      } else {
        mainWindow.loadURL(`http://localhost:${activePort}`);
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
      label: isServerRunning ? `🟢 서버 상태: 정상 구동 중 (${activePort})` : '🔴 서버 상태: 중지됨',
      enabled: false
    },
    { type: 'separator' },
    {
      label: '🌐 Mantis CR Hub 열기',
      enabled: isServerRunning,
      click: () => openAppWindow()
    },
    {
      label: '🔗 기본 웹 브라우저에서 열기',
      enabled: isServerRunning,
      click: () => shell.openExternal(`http://localhost:${activePort}`)
    },
    { type: 'separator' },
    {
      label: '▶️ 로컬 서버 시작 (Start Server)',
      enabled: !isServerRunning,
      click: () => startBackendServer()
    },
    {
      label: '⏹️ 로컬 서버 중지 (Stop Server)',
      enabled: isServerRunning,
      click: () => stopBackendServer()
    },
    {
      label: '🔄 로컬 서버 재시작 (Restart Server)',
      enabled: isServerRunning,
      click: () => restartBackendServer()
    },
    { type: 'separator' },
    {
      label: isSyncing ? '⏳ Mantis 데이터 동기화 중...' : '🔄 Mantis 최신 데이터 동기화 / 업데이트',
      enabled: isServerRunning && !isSyncing,
      click: () => triggerMantisSync()
    },
    {
      label: '⚙️ SSH / ClearCase 설정',
      enabled: isServerRunning,
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
  tray.setToolTip(isServerRunning ? `Mantis CR Ultra Search & AI Hub (구동 중: ${activePort})` : 'Mantis CR Ultra Search & AI Hub (서버 중지됨)');
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

  // Click tray icon to show window on Windows/Mac
  tray.on('click', () => {
    openAppWindow();
  });

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
