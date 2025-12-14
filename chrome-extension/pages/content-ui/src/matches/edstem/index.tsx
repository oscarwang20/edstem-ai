import inlineCss from '../../../dist/edstem/index.css?inline';
import { initAppWithShadow } from '@extension/shared';
import App from '@src/matches/edstem/App';

console.log('[EdStem Smart Search] Content script loading...');

initAppWithShadow({ id: 'edstem-smart-search', app: <App />, inlineCss });

console.log('[EdStem Smart Search] Content script initialized, message listener ready');
