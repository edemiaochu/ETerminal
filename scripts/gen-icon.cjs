const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:512px;height:512px;overflow:hidden;background:#05070d}
  .tile{position:absolute;inset:0;background:
    radial-gradient(circle at 16% 12%, rgba(192,132,252,.34), transparent 33%),
    radial-gradient(circle at 88% 84%, rgba(34,211,238,.26), transparent 38%),
    radial-gradient(circle at 78% 18%, rgba(124,240,212,.16), transparent 30%),
    linear-gradient(145deg,#0c1525 0%,#070b13 55%,#04060a 100%);
    display:grid;place-items:center}
  .inner{position:absolute;inset:54px;border-radius:88px;border:2px solid rgba(255,255,255,.14);
    background:linear-gradient(155deg,rgba(255,255,255,.10),rgba(255,255,255,.015) 45%,rgba(255,255,255,.04));
    box-shadow:inset 0 2px 0 rgba(255,255,255,.22), inset 0 -16px 50px rgba(0,0,0,.32), 0 32px 90px rgba(0,0,0,.55)}
  .inner:after{content:"";position:absolute;inset:0;border-radius:inherit;
    background:radial-gradient(circle at 30% 0%,rgba(255,255,255,.20),transparent 42%)}
  svg{position:relative;z-index:2;filter:drop-shadow(0 0 26px rgba(124,240,212,.20))}
</style></head><body><div class="tile"><div class="inner"></div>
<svg width="512" height="512" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="g" x1="150" y1="150" x2="370" y2="370" gradientUnits="userSpaceOnUse">
      <stop stop-color="#C4A7FF"/><stop offset=".52" stop-color="#22D3EE"/><stop offset="1" stop-color="#7CF0D4"/>
    </linearGradient>
  </defs>
  <path d="M172 180L252 256L172 332" stroke="url(#g)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M284 332H346" stroke="url(#g)" stroke-width="34" stroke-linecap="round"/>
</svg></div></body></html>`;

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  const payloads = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
    payloads.push(png);
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    backgroundColor: "#05070d",
    webPreferences: { offscreen: true },
  });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const dir = path.join(__dirname, "..", "build");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "icon.png"), image.toPNG());

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => ({
    size,
    png: image.resize({ width: size, height: size, quality: "best" }).toPNG(),
  }));
  fs.writeFileSync(path.join(dir, "icon.ico"), makeIco(images));
  console.log("[icon] wrote build/icon.png and build/icon.ico");
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
