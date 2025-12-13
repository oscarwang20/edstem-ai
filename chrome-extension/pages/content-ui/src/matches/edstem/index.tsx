import inlineCss from '../../../dist/edstem/index.css?inline';
import { initAppWithShadow } from '@extension/shared';
import App from './App';

// Only initialize on EdStem pages
if (window.location.hostname.includes('edstem.org')) {
  initAppWithShadow({
    id: 'edstem-smart-search',
    app: <App />,
    inlineCss,
  });
}
