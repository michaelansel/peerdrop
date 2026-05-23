import { defineConfig, type Plugin } from 'vite';

const REPO_BASE = '/peerdrop/';

/**
 * Build the Content-Security-Policy. The production policy is strict; the dev policy adds the
 * loopback origins the E2E suite's `?broker=` override points at (a local in-process broker).
 */
function contentSecurityPolicy(isProd: boolean): string {
  const connectSrc = [
    "'self'",
    'blob:',
    'wss://0.peerjs.com:443',
    'https://0.peerjs.com:443',
    'wss://*.peerjs.com',
    'https://*.peerjs.com',
    'stun:', // WebRTC ICE gathering against the configured STUN server
  ];
  if (!isProd) {
    connectSrc.push(
      'ws://localhost:*',
      'http://localhost:*',
      'ws://127.0.0.1:*',
      'http://127.0.0.1:*',
    );
  }
  return (
    [
      "default-src 'self'",
      `connect-src ${connectSrc.join(' ')}`,
      "img-src 'self' data:",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ') + ';'
  );
}

function cspPlugin(isProd: boolean): Plugin {
  return {
    name: 'peerdrop-csp',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: contentSecurityPolicy(isProd),
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  return {
    base: isProd ? REPO_BASE : '/',
    plugins: [cspPlugin(isProd)],
    define: {
      __DEV_BROKER_OVERRIDE__: JSON.stringify(!isProd),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      minify: 'esbuild',
    },
    server: {
      port: 5173,
    },
    preview: {
      port: 4173,
    },
  };
});
