import './styles.css';
import { mountApp } from './ui/app.js';

declare const __DEV_BROKER_OVERRIDE__: boolean;

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
