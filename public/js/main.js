import { startRenderer } from './render.js';
import { startInput } from './input.js';
import { initUI } from './ui.js';

const canvas = document.getElementById('world');
startRenderer(canvas);
startInput(canvas);
initUI();
