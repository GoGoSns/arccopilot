import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'ArcCopilot',
  version: '0.1.0',
  description: 'Your copilot for the Arc economy — wallet, dashboard, social, and AI in one extension',
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: [
        'https://*/*',
        'http://*/*',
        'http://localhost/*',
        'https://twitter.com/*',
        'https://x.com/*',
        'https://github.com/*',
        'https://www.youtube.com/*',
        'https://testnet.arcscan.app/*',
        'https://etherscan.io/*',
      ],
      js: ['src/content/content.ts'],
      run_at: 'document_idle',
    },
  ],
  options_page: 'src/options/index.html',
  permissions: ['storage', 'activeTab', 'scripting', 'tabs', 'notifications', 'sidePanel', 'alarms'],
  host_permissions: [
    'https://generativelanguage.googleapis.com/*',
    'https://rpc.testnet.arc.network/*',
    'https://testnet.arcscan.app/*',
    'https://api.twitterapi.io/*',
    'https://*/*',
    'http://*/*'
  ],
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
})
