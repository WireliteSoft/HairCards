import GUI from '../vendor/lil-gui/lil-gui.esm.js';

// Canvas setup
const container = document.getElementById('canvas');
const cv = document.createElement('canvas');
const ctx = cv.getContext('2d', { alpha: true, willReadFrequently: false });
cv.style.position = 'absolute';
cv.style.inset = '0';
cv.style.width = '100%';
cv.style.height = '100%';
container.appendChild(cv);

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const params = {
  width: 512,
  height: 2048,
  strands: 120,
  strandSpread: 0.9, // 0..1 margin horizontally
  thicknessRoot: 2.0,
  thicknessTip: 0.3,
  jitter: 0.6,
  waveAmp: 6.0,
  waveFreq: 3.0,
  curlAmp: 0.0,
  seed: 1,
  rootColor: '#8c8c8c',
  tipColor: '#666666',
  rootAlpha: 1.0,
  tipAlpha: 0.0,
  horizFeather: 0.1, // fade at sides
  backgroundAlpha: 0.0,
  previewScale: 0.6,
  generate: () => draw(),
  download: () => savePNG(),
};

function onResize() {
  const w = Math.max(320, container.clientWidth);
  const h = Math.max(320, container.clientHeight);
  cv.width = Math.round(params.width * params.previewScale);
  cv.height = Math.round(params.height * params.previewScale);
  draw();
}
window.addEventListener('resize', onResize);

// GUI
const gui = new GUI({ container: document.getElementById('sidebar') });
const sizeFolder = gui.addFolder('Output');
sizeFolder.add(params, 'width', 64, 4096, 1).onFinishChange(onResize);
sizeFolder.add(params, 'height', 64, 4096, 1).onFinishChange(onResize);
sizeFolder.add(params, 'previewScale', 0.1, 1, 0.05).name('Preview Scale').onChange(onResize);
sizeFolder.add(params, 'backgroundAlpha', 0, 1, 0.01).name('BG Alpha').onChange(draw);
sizeFolder.add(params, 'download').name('Download PNG');

const hairFolder = gui.addFolder('Strands');
hairFolder.add(params, 'strands', 1, 1000, 1).onFinishChange(draw);
hairFolder.add(params, 'strandSpread', 0.2, 1, 0.01).onChange(draw);
hairFolder.add(params, 'thicknessRoot', 0.1, 8, 0.05).name('Root Thickness').onChange(draw);
hairFolder.add(params, 'thicknessTip', 0.05, 6, 0.05).name('Tip Thickness').onChange(draw);
hairFolder.add(params, 'jitter', 0, 2, 0.01).onChange(draw);
hairFolder.add(params, 'waveAmp', 0, 20, 0.1).onChange(draw);
hairFolder.add(params, 'waveFreq', 0, 8, 0.05).onChange(draw);
hairFolder.add(params, 'curlAmp', 0, 30, 0.1).onChange(draw);
hairFolder.add(params, 'seed', 1, 9999, 1).onFinishChange(draw);

const colorFolder = gui.addFolder('Color / Alpha');
colorFolder.addColor(params, 'rootColor').onChange(draw);
colorFolder.addColor(params, 'tipColor').onChange(draw);
colorFolder.add(params, 'rootAlpha', 0, 1, 0.01).onChange(draw);
colorFolder.add(params, 'tipAlpha', 0, 1, 0.01).onChange(draw);

document.getElementById('downloadBtn')?.addEventListener('click', () => savePNG());
document.getElementById('copyBtn')?.addEventListener('click', () => copyToClipboard());

function hexToRgb(hex) {
  const c = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return c ? { r: parseInt(c[1], 16), g: parseInt(c[2], 16), b: parseInt(c[3], 16) } : { r: 255, g: 255, b: 255 };
}
function lerp(a, b, t) { return a + (b - a) * t; }

function draw() {
  // Resize backing store to exact preview dims
  cv.width = Math.round(params.width * params.previewScale);
  cv.height = Math.round(params.height * params.previewScale);

  // Fill transparent background
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (params.backgroundAlpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${params.backgroundAlpha})`;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }

  const rand = mulberry32(params.seed >>> 0);
  const W = cv.width, H = cv.height;
  const margin = (1 - params.strandSpread) * 0.5 * W;

  const rc = hexToRgb(params.rootColor);
  const tc = hexToRgb(params.tipColor);

  // Horizontal feather mask near edges
  const feather = Math.max(0, Math.min(0.49, params.horizFeather));
  const fadeL = feather * W, fadeR = W - fadeL;

  // Draw strands from top (root) to bottom (tip)
  for (let s = 0; s < params.strands; s++) {
    // Base x position with jitter
    const baseX = lerp(margin, W - margin, (s + 0.5) / params.strands);
    const jitter = (rand() - 0.5) * params.jitter * (W / params.strands);
    const x0 = baseX + jitter;

    // Oscillation phases per strand
    const phase = rand() * Math.PI * 2;
    const curlPhase = rand() * Math.PI * 2;

    ctx.beginPath();
    let lastX = x0, lastY = 0;
    for (let y = 0; y <= H; y += 2) {
      const t = y / H;
      const wiggle = Math.sin(phase + t * Math.PI * 2 * params.waveFreq) * params.waveAmp;
      const curl = Math.sin(curlPhase + t * Math.PI * 6.0) * params.curlAmp * t;
      const x = x0 + wiggle + curl;
      if (y === 0) ctx.moveTo(x, 0); else ctx.lineTo(x, y);
      lastX = x; lastY = y;
    }
    // Color + alpha gradient
    const grad = ctx.createLinearGradient(lastX, 0, lastX, H);
    grad.addColorStop(0, `rgba(${rc.r},${rc.g},${rc.b},${params.rootAlpha})`);
    grad.addColorStop(1, `rgba(${tc.r},${tc.g},${tc.b},${params.tipAlpha})`);
    ctx.strokeStyle = grad;
    const thick = lerp(params.thicknessRoot, params.thicknessTip, 1.0);
    ctx.lineWidth = thick;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Side feathering pass
  if (feather > 0) {
    const gL = ctx.createLinearGradient(0, 0, fadeL, 0);
    gL.addColorStop(0, 'rgba(0,0,0,1)');
    gL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gL; ctx.fillRect(0, 0, fadeL, H);
    const gR = ctx.createLinearGradient(W - fadeL, 0, W, 0);
    gR.addColorStop(0, 'rgba(0,0,0,0)');
    gR.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gR; ctx.fillRect(W - fadeL, 0, fadeL, H);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function savePNG() {
  // Re-render at full resolution to export
  const tmp = document.createElement('canvas');
  tmp.width = params.width; tmp.height = params.height;
  const tctx = tmp.getContext('2d', { alpha: true });
  // Draw with scale 1
  const prevScale = params.previewScale;
  const prevCanvas = cv; const prevCtx = ctx;
  const backup = { ...params };
  const localCtx = tctx;
  // Minimal reimplementation of draw for tmp (avoid duplication via scale switch)
  (function drawFull(ctxOut, W, H){
    ctxOut.clearRect(0,0,W,H);
    if (params.backgroundAlpha > 0) { ctxOut.fillStyle = `rgba(0,0,0,${params.backgroundAlpha})`; ctxOut.fillRect(0,0,W,H); }
    const rand = mulberry32(params.seed >>> 0);
    const margin = (1 - params.strandSpread) * 0.5 * W;
    const rc = hexToRgb(params.rootColor); const tc = hexToRgb(params.tipColor);
    const feather = Math.max(0, Math.min(0.49, params.horizFeather));
    const fadeL = feather * W;
    for (let s = 0; s < params.strands; s++) {
      const baseX = lerp(margin, W - margin, (s + 0.5) / params.strands);
      const jitter = (rand() - 0.5) * params.jitter * (W / params.strands);
      const x0 = baseX + jitter;
      const phase = rand() * Math.PI * 2; const curlPhase = rand() * Math.PI * 2;
      ctxOut.beginPath();
      let lastX = x0;
      for (let y = 0; y <= H; y += 2) {
        const t = y / H;
        const wiggle = Math.sin(phase + t * Math.PI * 2 * params.waveFreq) * params.waveAmp;
        const curl = Math.sin(curlPhase + t * Math.PI * 6.0) * params.curlAmp * t;
        const x = x0 + wiggle + curl; if (y === 0) ctxOut.moveTo(x, 0); else ctxOut.lineTo(x, y); lastX = x;
      }
      const grad = ctxOut.createLinearGradient(lastX, 0, lastX, H);
      grad.addColorStop(0, `rgba(${rc.r},${rc.g},${rc.b},${params.rootAlpha})`);
      grad.addColorStop(1, `rgba(${tc.r},${tc.g},${tc.b},${params.tipAlpha})`);
      ctxOut.strokeStyle = grad; ctxOut.lineWidth = lerp(params.thicknessRoot, params.thicknessTip, 1.0); ctxOut.lineCap='round'; ctxOut.lineJoin='round'; ctxOut.stroke();
    }
    if (feather > 0) {
      const gL = ctxOut.createLinearGradient(0,0,fadeL,0); gL.addColorStop(0,'rgba(0,0,0,1)'); gL.addColorStop(1,'rgba(0,0,0,0)');
      ctxOut.globalCompositeOperation='destination-out'; ctxOut.fillStyle=gL; ctxOut.fillRect(0,0,fadeL,H);
      const gR = ctxOut.createLinearGradient(W-fadeL,0,W,0); gR.addColorStop(0,'rgba(0,0,0,0)'); gR.addColorStop(1,'rgba(0,0,0,1)');
      ctxOut.fillStyle=gR; ctxOut.fillRect(W-fadeL,0,fadeL,H); ctxOut.globalCompositeOperation='source-over';
    }
  })(tctx, tmp.width, tmp.height);

  const link = document.createElement('a');
  link.href = tmp.toDataURL('image/png');
  link.download = `hair_texture_${params.width}x${params.height}.png`;
  link.click();
}

async function copyToClipboard() {
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  try {
    await navigator.clipboard.write([
      new window.ClipboardItem({ 'image/png': blob })
    ]);
  } catch (e) {
    console.warn('Clipboard write failed', e);
  }
}

onResize();

