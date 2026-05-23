import './styles.css';
import { mountApp } from './ui/app.js';

declare const __DEV_BROKER_OVERRIDE__: boolean;

// Clickjacking defense for the security-critical SAS-confirm click. GitHub Pages cannot send
// X-Frame-Options, and `frame-ancestors` is ignored when CSP is delivered via <meta>, so the
// only reliable guard is to refuse to render when framed.
if (window.top !== window.self) {
  document.body.textContent = 'PeerDrop cannot run inside a frame.';
  throw new Error('refusing to run inside a frame');
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root element missing');
}

let brokerUrl: string | undefined;
if (__DEV_BROKER_OVERRIDE__) {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('broker');
  if (override) {
    brokerUrl = override;
  }
}

mountApp({ root }, { brokerUrl });
