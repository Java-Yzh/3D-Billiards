import { Game } from './game';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const game = new Game(canvas);
(window as unknown as { game: Game }).game = game;
