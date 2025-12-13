import inlineCss from '../../../dist/edstem/index.css?inline';
import { initAppWithShadow } from '@extension/shared';
import App from '@src/matches/edstem/App';

initAppWithShadow({ id: 'edstem-smart-search', app: <App />, inlineCss });
