const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js');
const targetDir = path.join(__dirname, '..', 'src', 'renderer', 'vendor');
const target = path.join(targetDir, 'hls.min.js');

fs.mkdirSync(targetDir, { recursive: true });

if (!fs.existsSync(source)) {
  console.error('hls.js is not installed. Run "npm install" first.');
  process.exit(1);
}

fs.copyFileSync(source, target);
console.log('hls.js copied to src/renderer/vendor/hls.min.js');
