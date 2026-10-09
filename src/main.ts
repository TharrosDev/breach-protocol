import { boot } from './app/boot';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');
boot(root);
