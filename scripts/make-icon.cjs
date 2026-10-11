const Jimp = require('jimp-compact');
const fs = require('node:fs');
const image = new Jimp(1024, 1024, '#090a0a');
function rectangle(x, y, w, h, color) {
  const value = Jimp.cssColorToHex(color);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) image.setPixelColor(value, xx, yy);
}
rectangle(305, 275, 380, 470, '#53662d');
rectangle(280, 300, 380, 470, '#829e3d');
rectangle(255, 325, 380, 470, '#c8f45a');
rectangle(281, 351, 328, 418, '#111313');
rectangle(324, 420, 220, 20, '#f3f3ee');
rectangle(324, 475, 170, 16, '#a1a7a3');
rectangle(324, 527, 220, 16, '#a1a7a3');
rectangle(324, 579, 135, 16, '#a1a7a3');
rectangle(682, 216, 22, 110, '#c8f45a');
rectangle(638, 260, 110, 22, '#c8f45a');
fs.mkdirSync('assets', { recursive: true });
image.writeAsync('assets/icon.png');
