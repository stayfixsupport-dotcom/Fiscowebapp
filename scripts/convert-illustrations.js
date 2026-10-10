const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..', 'public', 'assets', 'illustrations');
const out = path.join(root, 'converted');
fs.mkdirSync(out, { recursive: true });

const files = ['01.svg', 'Avatar Number=01.svg', 'Avatar Number=02.svg'];
for (const file of files) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) continue;

  const dest = path.join(out, `${path.basename(file, path.extname(file))}.webp`);
  sharp(src, { density: 300 })
    .resize(1024, 1024, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 84, effort: 6 })
    .toFile(dest)
    .then(() => console.log(`converted ${file} -> ${path.basename(dest)}`))
    .catch((error) => {
      console.error(`failed ${file}`, error);
      process.exitCode = 1;
    });
}
