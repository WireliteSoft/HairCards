import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from '../vendor/three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from '../vendor/three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from '../vendor/three/examples/jsm/exporters/GLTFExporter.js';
import GUI from '../vendor/lil-gui/lil-gui.esm.js';

// Basic scene setup
const container = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);

const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.01, 2000);
camera.position.set(0.6, 0.4, 1.3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const grid = new THREE.GridHelper(10, 100, 0x333a52, 0x252a3b);
grid.position.y = 0;
scene.add(grid);

// Axes at world origin (slightly prioritized to avoid z-fighting)
const axes = new THREE.AxesHelper(0.5);
axes.position.set(0, 0, 0);
axes.visible = true;
axes.renderOrder = 999;
if (axes.material) axes.material.depthTest = false;
scene.add(axes);

// Floor: checkerboard
const floorTex = makeCheckerTexture(8, '#1a1e2b', '#141724');
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(40, 40);
const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1.0, metalness: 0.0 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.name = 'Floor';
scene.add(floor);

// Lighting
const hemi = new THREE.HemisphereLight(0xffffee, 0x222233, 0.6);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(2, 2, 2);
dir.castShadow = false;
scene.add(dir);

// Groups
const root = new THREE.Group();
scene.add(root);
const hairGroup = new THREE.Group();
hairGroup.name = 'HairCards';
scene.add(hairGroup);

// Mirror plane visual and control
const mirrorGizmo = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })
);
mirrorGizmo.name = 'MirrorPlaneGizmo';
mirrorGizmo.visible = false;
scene.add(mirrorGizmo);

function updateMirrorVisual() {
  mirrorGizmo.visible = placeParams.mirrorEnabled || placeParams.editMirrorPlane;
  // Orient to axis
  mirrorGizmo.rotation.set(0, 0, 0);
  if (placeParams.mirrorAxis === 'X') mirrorGizmo.rotation.y = -Math.PI / 2; // YZ plane
  if (placeParams.mirrorAxis === 'Y') mirrorGizmo.rotation.x = Math.PI / 2;  // XZ plane
  if (placeParams.mirrorAxis === 'Z') mirrorGizmo.rotation.set(0, 0, 0);     // XY plane
  mirrorGizmo.position.set(0, 0, 0);
  if (placeParams.mirrorAxis === 'X') mirrorGizmo.position.x = placeParams.mirrorPlane;
  if (placeParams.mirrorAxis === 'Y') mirrorGizmo.position.y = placeParams.mirrorPlane;
  if (placeParams.mirrorAxis === 'Z') mirrorGizmo.position.z = placeParams.mirrorPlane;
}

function setEditMirrorPlane(on) {
  placeParams.editMirrorPlane = !!on;
  updateMirrorVisual();
  if (placeParams.editMirrorPlane) {
    // Lock transform to translate along the chosen axis
    setTransformMode('translate', true);
    tControls.attach(mirrorGizmo);
    tControls.showX = (placeParams.mirrorAxis === 'X');
    tControls.showY = (placeParams.mirrorAxis === 'Y');
    tControls.showZ = (placeParams.mirrorAxis === 'Z');
  } else {
    if (tControls.object === mirrorGizmo) tControls.detach();
    tControls.showX = tControls.showY = tControls.showZ = true;
  }
}

// When moving the mirror plane with the gizmo, sync the numeric value
// objectChange listener is attached after TransformControls is created

// Globals
let currentModel = null;
let currentHairTexture = makeDefaultHairTexture();
const STORAGE_KEY = 'fht_project_v1';
let saveTimer = null;
// History (Undo)
const HISTORY_LIMIT = 500;
const history = [];
let historyPtr = -1;
let isRestoringHistory = false;
let placingEnabled = true; // click to place
let selectedCard = null; // primary selection (for gizmo)
let selectedCards = new Set();
let cardCounter = 1;

// Card list UI
const cardItemsEl = document.getElementById('cardItems');
const selectAllEl = document.getElementById('selectAllCards');

function refreshCardList() {
  if (!cardItemsEl) return;
  cardItemsEl.innerHTML = '';
  // Update header Select All state
  if (selectAllEl) {
    const total = hairGroup.children.length;
    const sel = selectedCards.size;
    selectAllEl.indeterminate = sel > 0 && sel < total;
    selectAllEl.checked = total > 0 && sel === total;
  }
  hairGroup.children.forEach((card, idx) => {
    if (!card.name || card.name === 'HairCard') {
      card.name = `HairCard ${idx + 1}`;
    }
    const row = document.createElement('div');
    const isSel = selectedCards.has(card);
    row.className = 'card-item' + (isSel ? ' selected' : '');
    row.dataset.uuid = card.uuid;

    // Checkbox for multi-select
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'card-check';
    checkbox.checked = isSel;
    checkbox.addEventListener('click', ev => ev.stopPropagation());
    checkbox.addEventListener('change', (ev) => {
      if (checkbox.checked) {
        selectedCards.add(card);
        selectedCard = card; // make it primary for gizmo
      } else {
        selectedCards.delete(card);
        if (selectedCard === card) selectedCard = Array.from(selectedCards).pop() || null;
      }
      if (placingEnabled || !selectedCard) tControls.detach(); else tControls.attach(selectedCard);
      updateTransformVisibility();
      refreshCardList();
    });
    row.appendChild(checkbox);

    const nameSpan = document.createElement('div');
    nameSpan.className = 'card-name';
    nameSpan.title = card.name;
    nameSpan.textContent = card.name;
    row.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const focusBtn = document.createElement('button');
    focusBtn.className = 'icon-btn';
    focusBtn.textContent = 'Focus';
    focusBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      focusOnCard(card);
    });
    actions.appendChild(focusBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hairGroup.remove(card);
      // If points belong to this card, remove them too
      if (typeof segmentEdit !== 'undefined' && segmentEdit.activeCard === card) {
        clearSegmentHandles();
      }
      if (selectedCards.has(card)) selectedCards.delete(card);
      if (selectedCard === card) selectedCard = Array.from(selectedCards).pop() || null;
      if (!selectedCard) tControls.detach(); else tControls.attach(selectedCard);
      // Rebuild points for remaining single selection
      if (typeof segmentEdit !== 'undefined') {
        if (selectedCards.size === 1 && selectedCard) buildSegmentHandles(selectedCard); else clearSegmentHandles();
      }
      refreshCardList();
      scheduleSave();
      pushHistory('delete');
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);

    row.addEventListener('click', (ev) => {
      // Row click selects only this card (single-select). Use checkboxes for multi-select.
      selectCard(card, false);
      refreshCardList();
    });
    row.addEventListener('dblclick', () => {
      const newName = prompt('Rename hair card:', card.name);
      if (newName && newName.trim()) {
        card.name = newName.trim();
        refreshCardList();
      }
    });

    cardItemsEl.appendChild(row);
  });
}

// Select All checkbox handler
selectAllEl?.addEventListener('change', () => {
  if (selectAllEl.checked) {
    selectedCards.clear();
    hairGroup.children.forEach(c => selectedCards.add(c));
    selectedCard = hairGroup.children[hairGroup.children.length - 1] || null;
    if (!placingEnabled && selectedCard) tControls.attach(selectedCard); else tControls.detach();
  } else {
    clearSelection();
  }
  refreshCardList();
});

function focusOnCard(card) {
  if (!card) return;
  const pos = new THREE.Vector3();
  card.getWorldPosition(pos);
  controls.target.copy(pos);
  controls.update();
  // Move camera slightly back along its view direction to frame the card
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  camera.position.copy(pos.clone().addScaledVector(dir, -0.5 * modelScale));
}

// Transform controls for editing
const tControls = new TransformControls(camera, renderer.domElement);
tControls.size = 0.8;
tControls.setSpace('local');
tControls.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
});
let isTransformInteracting = false;
tControls.addEventListener('mouseDown', () => { isTransformInteracting = true; });
tControls.addEventListener('mouseUp', () => { isTransformInteracting = false; if (tControls.object && tControls.object.userData && tControls.object.userData.isSegmentHandle) return; pushHistory('transform'); });
scene.add(tControls);

// Sync mirror plane numeric value when moving its gizmo
tControls.addEventListener('objectChange', () => {
  if (tControls.object !== mirrorGizmo) return;
  const pos = mirrorGizmo.position;
  if (placeParams.mirrorAxis === 'X') placeParams.mirrorPlane = pos.x;
  if (placeParams.mirrorAxis === 'Y') placeParams.mirrorPlane = pos.y;
  if (placeParams.mirrorAxis === 'Z') placeParams.mirrorPlane = pos.z;
  scheduleSave();
});

// Transform mode toggle buttons
const moveModeBtn = document.getElementById('moveModeBtn');
const rotateModeBtn = document.getElementById('rotateModeBtn');
const placeModeBtn = document.getElementById('placeModeBtn');
const selectModeBtn = document.getElementById('selectModeBtn');
const undoBtn = document.getElementById('undoBtn');

function setToggleActive(el, active) {
  if (!el) return;
  el.classList.toggle('active', !!active);
  el.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function setTransformMode(mode, switchToSelect = false) {
  tControls.setMode(mode);
  setToggleActive(moveModeBtn, mode === 'translate');
  setToggleActive(rotateModeBtn, mode === 'rotate');
  if (switchToSelect) setPlacementMode('Select');
}

moveModeBtn?.addEventListener('click', () => setTransformMode('translate', true));
rotateModeBtn?.addEventListener('click', () => setTransformMode('rotate', true));
setTransformMode('translate', false);

function setPlacementMode(mode) {
  placingEnabled = (mode === 'Place');
  placeParams.mode = mode;
  // Sync topbar buttons
  setToggleActive(placeModeBtn, placingEnabled);
  setToggleActive(selectModeBtn, !placingEnabled);
  // Sync GUI dropdown if present
  if (typeof modeController !== 'undefined' && modeController && typeof modeController.setValue === 'function') {
    if (modeController.getValue && modeController.getValue() !== mode) modeController.setValue(mode);
    else if (!modeController.getValue) { modeController.updateDisplay && modeController.updateDisplay(); }
  }
  updateTransformVisibility();
  updateControlsEnabled();
}

placeModeBtn?.addEventListener('click', () => setPlacementMode('Place'));
selectModeBtn?.addEventListener('click', () => setPlacementMode('Select'));

// rotation buttons removed; rotation is controlled via the properties panel inputs

// GUI
const gui = new GUI({ container: document.getElementById('sidebar') });
const modelFolder = gui.addFolder('Model');
const viewParams = { showAxes: true, showGrid: true, showFloor: true, overlayMode: 'Off', overlayNormalsDensity: 4, overlayNormalsLength: 0.03 };
modelFolder.add(viewParams, 'showAxes').name('Show Axes').onChange(v => axes.visible = v);
modelFolder.add(viewParams, 'showGrid').name('Show Grid').onChange(v => grid.visible = v);
modelFolder.add(viewParams, 'showFloor').name('Show Floor').onChange(v => floor.visible = v);
modelFolder.add(viewParams, 'overlayMode', ['Off','Edges','Verts','Normals']).name('Model Overlay').onChange(() => updateModelOverlay());
const overlayLenCtrl = modelFolder.add(viewParams, 'overlayNormalsLength', 0.005, 0.2, 0.001).name('Normals Length').onChange(() => updateModelOverlay());
const overlayDenCtrl = modelFolder.add(viewParams, 'overlayNormalsDensity', 1, 50, 1).name('Normals Density').onChange(() => updateModelOverlay());
modelFolder.add({ clear: () => unloadModel() }, 'clear').name('Unload Model');

const placeParams = {
  width: 0.025,
  length: 0.12,
  segments: 8,
  curvature: 0.2, // 0..1
  taper: 0.2,     // 0..1
  offset: 0.002,
  alphaTest: 0.1,
  doubleSided: true,
  density: 1,
  mode: 'Place',
  // Mirror placement
  mirrorEnabled: false,
  mirrorAxis: 'X', // X | Y | Z
  mirrorPlane: 0.0, // world coordinate of symmetry plane along axis
  editMirrorPlane: false,
};

const placeFolder = gui.addFolder('Hair Cards');
function updateTransformVisibility() {
  if (placingEnabled) {
    tControls.visible = false;
    tControls.enabled = false;
    tControls.detach();
  } else {
    tControls.visible = true;
    tControls.enabled = true;
    // If currently editing a segment handle, don't override the attachment
    if (tControls.object && tControls.object.userData && tControls.object.userData.isSegmentHandle) {
      // keep attached to handle
    } else if (selectedCard && tControls.object !== selectedCard) {
      tControls.attach(selectedCard);
    }
  }
}
const modeController = placeFolder
  .add(placeParams, 'mode', ['Place', 'Select'])
  .name('Mode')
  .onChange(v => {
    setPlacementMode(v);
  });
// Hide dropdown since we now use top bar buttons
modeController.hide();
// Initialize placement mode UI and state
setPlacementMode(placeParams.mode);
const widthCtrl = placeFolder.add(placeParams, 'width', 0.005, 0.08, 0.001).onChange(v => updateSelectedCardsParam('width', v * modelScale));
const lengthCtrl = placeFolder.add(placeParams, 'length', 0.02, 1, 0.001).onChange(v => updateSelectedCardsParam('length', v * modelScale));
const segmentsCtrl = placeFolder.add(placeParams, 'segments', 1, 20, 1).onChange(v => updateSelectedCardsParam('segments', v));
const curvatureCtrl = placeFolder.add(placeParams, 'curvature', -1, 1, 0.01).onChange(v => updateSelectedCardsParam('curvature', v));
const taperCtrl = placeFolder.add(placeParams, 'taper', 0, 1, 0.01).onChange(v => updateSelectedCardsParam('taper', v));
const offsetCtrl = placeFolder.add(placeParams, 'offset', 0, 0.01, 0.0005).onChange(v => updateSelectedCardsParam('offset', v * modelScale));

// Push history when finishing slider edits to avoid excessive snapshots
widthCtrl.onFinishChange(() => pushHistory('width'));
lengthCtrl.onFinishChange(() => pushHistory('length'));
segmentsCtrl.onFinishChange(() => pushHistory('segments'));
curvatureCtrl.onFinishChange(() => pushHistory('curvature'));
taperCtrl.onFinishChange(() => pushHistory('taper'));
offsetCtrl.onFinishChange(() => pushHistory('offset'));

// Mirror placement controls (moved to dedicated section)
const mirrorFolder = gui.addFolder('Mirror');
mirrorFolder.add(placeParams, 'mirrorEnabled').name('Mirror Place')
  .onChange(() => { updateMirrorVisual(); scheduleSave(); pushHistory('mirror-toggle'); });
mirrorFolder.add(placeParams, 'mirrorAxis', ['X','Y','Z']).name('Mirror Axis')
  .onChange(() => { updateMirrorVisual(); scheduleSave(); pushHistory('mirror-axis'); });
const mirrorPlaneCtrl = mirrorFolder.add(placeParams, 'mirrorPlane', -100, 100, 0.001).name('Mirror Plane')
  .onChange(() => { updateMirrorVisual(); scheduleSave(); })
  .onFinishChange(() => pushHistory('mirror-plane'));
mirrorFolder.add(placeParams, 'editMirrorPlane').name('Edit Mirror Plane')
  .onChange(v => { setEditMirrorPlane(v); scheduleSave(); });
mirrorFolder.add({ setMirrorToModelCenter: () => {
  const box = new THREE.Box3();
  if (currentModel) {
    box.setFromObject(currentModel);
    const c = new THREE.Vector3(); box.getCenter(c);
    if (placeParams.mirrorAxis === 'X') placeParams.mirrorPlane = c.x;
    if (placeParams.mirrorAxis === 'Y') placeParams.mirrorPlane = c.y;
    if (placeParams.mirrorAxis === 'Z') placeParams.mirrorPlane = c.z;
  } else {
    // fallback: scene origin
    placeParams.mirrorPlane = 0;
  }
  mirrorPlaneCtrl.updateDisplay();
  updateMirrorVisual();
  scheduleSave();
  pushHistory('mirror-center');
}}, 'setMirrorToModelCenter').name('Set Plane = Model Center');
placeFolder.add(placeParams, 'alphaTest', 0, 1, 0.01).onChange(v => updateAllMaterials({ alphaTest: v }));
placeFolder.add(placeParams, 'doubleSided').onChange(v => updateAllMaterials({ doubleSided: v }));
placeFolder.add({ clearHair: () => clearHair() }, 'clearHair').name('Clear All Cards');
// Now that the GUI exists, safely sync the initial transform mode without changing placement mode
setTransformMode('translate', false);

const selectedFolder = gui.addFolder('Selected Card');
const selectedParams = { delete: () => deleteSelected(), duplicate: () => duplicateSelected() };
selectedFolder.add({ attachToFace: () => alignSelectedToFaceNormal() }, 'attachToFace').name('Re-align to Normal');
selectedFolder.add(selectedParams, 'duplicate').name('Duplicate');
selectedFolder.add(selectedParams, 'delete').name('Delete');

// Batch rotate selected (text inputs in properties panel)
const rotParams = { rx: 0, ry: 0, rz: 0 };
const rotLast = { rx: 0, ry: 0, rz: 0 };
// Batch overall scale for selected
const scaleParams = { s: 1 };
let scaleLast = 1;

function applyRotationDelta(axis, deltaDeg) {
  if (selectedCards.size === 0) return;
  if (!deltaDeg) return;
  const rad = THREE.MathUtils.degToRad(deltaDeg);
  const axisVec = axis === 'x' ? new THREE.Vector3(1,0,0)
                  : axis === 'y' ? new THREE.Vector3(0,1,0)
                  : new THREE.Vector3(0,0,1);
  for (const card of selectedCards) {
    card.rotateOnAxis(axisVec, rad);
  }
  scheduleSave();
}

let rxCtrl, ryCtrl, rzCtrl;
rxCtrl = selectedFolder.add(rotParams, 'rx').name('Rotate X (°)').onChange(v => { const d = v - rotLast.rx; rotLast.rx = v; applyRotationDelta('x', d); });
ryCtrl = selectedFolder.add(rotParams, 'ry').name('Rotate Y (°)').onChange(v => { const d = v - rotLast.ry; rotLast.ry = v; applyRotationDelta('y', d); });
rzCtrl = selectedFolder.add(rotParams, 'rz').name('Rotate Z (°)').onChange(v => { const d = v - rotLast.rz; rotLast.rz = v; applyRotationDelta('z', d); });
rxCtrl.onFinishChange(() => pushHistory('rotateX'));
ryCtrl.onFinishChange(() => pushHistory('rotateY'));
rzCtrl.onFinishChange(() => pushHistory('rotateZ'));

function applyScaleFactor(factor) {
  if (selectedCards.size === 0) return;
  if (!isFinite(factor) || factor === 0) return;
  for (const card of selectedCards) {
    card.scale.multiplyScalar(factor);
  }
  scheduleSave();
}

let sCtrl;
sCtrl = selectedFolder.add(scaleParams, 's', 0.001, 5, 0.001).name('Scale').onChange(v => {
  const factor = v / (scaleLast || 1);
  scaleLast = v || 1;
  applyScaleFactor(factor);
});
sCtrl.onFinishChange(() => pushHistory('scale'));

function resetRotationInputs() {
  rotParams.rx = rotParams.ry = rotParams.rz = 0;
  rotLast.rx = rotLast.ry = rotLast.rz = 0;
  rxCtrl && rxCtrl.updateDisplay && rxCtrl.updateDisplay();
  ryCtrl && ryCtrl.updateDisplay && ryCtrl.updateDisplay();
  rzCtrl && rzCtrl.updateDisplay && rzCtrl.updateDisplay();
  // reset scale input
  scaleParams.s = 1; scaleLast = 1;
  sCtrl && sCtrl.updateDisplay && sCtrl.updateDisplay();
}

// Raycaster setup
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Materials
function makeHairMaterial(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: placeParams.alphaTest,
    side: placeParams.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  return mat;
}

let sharedHairMaterial = makeHairMaterial(currentHairTexture);

// Approximate model scale (max dimension) to scale card sizes
let modelScale = 1;

function updateAllMaterials({ alphaTest, doubleSided }) {
  hairGroup.traverse(obj => {
    if (obj.isMesh && obj.material && obj.material.isMaterial) {
      if (typeof alphaTest === 'number') obj.material.alphaTest = alphaTest;
      if (typeof doubleSided === 'boolean') obj.material.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      obj.material.needsUpdate = true;
    }
  });
  scheduleSave();
  pushHistory('materials');
}

// Default procedural hair texture (vertical alpha gradient)
function makeDefaultHairTexture() {
  const w = 64, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  // Root at top (opaque) -> tip at bottom (transparent)
  grad.addColorStop(0, 'rgba(90,90,90,1.0)');
  grad.addColorStop(0.7, 'rgba(70,70,70,0.4)');
  grad.addColorStop(1, 'rgba(60,60,60,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // subtle noise
  const imgData = ctx.getImageData(0,0,w,h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() * 20) | 0;
    d[i] = d[i] + n;
    d[i+1] = d[i+1] + n;
    d[i+2] = d[i+2] + n;
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Simple checkerboard procedural texture
function makeCheckerTexture(tiles = 8, colorA = '#2a2e3f', colorB = '#202538') {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const tileSize = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      ctx.fillStyle = ((x + y) % 2 === 0) ? colorA : colorB;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Hair card geometry creation with bend + taper
function createHairCardGeometry(width, length, segments, curvature, taper, segmentOffsets) {
  const geo = new THREE.PlaneGeometry(width, length, 1, Math.max(1, segments));
  // Keep geometry centered (top at +length/2, bottom at -length/2), then we'll offset via a parent pivot.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i); // [-length/2 .. +length/2]
    const t = THREE.MathUtils.clamp((length * 0.5 - y) / length, 0, 1); // 0 at root (top), 1 at tip (bottom)
    const bend = curvature * (t * t); // bend outward along +Z
    const taperW = THREE.MathUtils.lerp(1, taper, t);
    pos.setX(i, x * taperW);
    pos.setZ(i, bend * length);
  }
  // Apply per-row segment offsets (local space) if provided
  if (Array.isArray(segmentOffsets) && segmentOffsets.length === Math.max(1, segments) + 1) {
    const rows = Math.max(1, segments) + 1;
    for (let r = 0; r < rows; r++) {
      const off = segmentOffsets[r];
      if (!off) continue;
      const ox = Array.isArray(off) ? off[0] : (off.x || 0);
      const oy = Array.isArray(off) ? off[1] : (off.y || 0);
      const oz = Array.isArray(off) ? off[2] : (off.z || 0);
      // widthSegments = 1, so two columns per row: c=0,1
      const i0 = r * 2 + 0;
      const i1 = r * 2 + 1;
      pos.setX(i0, pos.getX(i0) + ox); pos.setY(i0, pos.getY(i0) + oy); pos.setZ(i0, pos.getZ(i0) + oz);
      pos.setX(i1, pos.getX(i1) + ox); pos.setY(i1, pos.getY(i1) + oy); pos.setZ(i1, pos.getZ(i1) + oz);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createHairCard(params, material) {
  // Ensure segmentOffsets exists and matches segments+1
  const rows = Math.max(1, params.segments) + 1;
  const segOff = Array.isArray(params.segmentOffsets) && params.segmentOffsets.length === rows
    ? params.segmentOffsets
    : Array.from({ length: rows }, () => [0, 0, 0]);
  const geo = createHairCardGeometry(params.width, params.length, params.segments, params.curvature, params.taper, segOff);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const card = new THREE.Group();
  card.name = `HairCard ${cardCounter++}`;
  // Offset mesh so that the group's origin is at the ROOT (top edge)
  mesh.position.y = -params.length / 2;
  card.add(mesh);
  // Store per-card parameters for live editing
  card.userData.params = { width: params.width, length: params.length, segments: params.segments, curvature: params.curvature, taper: params.taper, offset: params.offset ?? 0, segmentOffsets: segOff };
  return card;
}

function clearHair() {
  tControls.detach();
  while (hairGroup.children.length) hairGroup.remove(hairGroup.children[0]);
  selectedCard = null; selectedCards.clear();
  clearSegmentHandles();
  refreshCardList();
  scheduleSave();
  pushHistory('clearHair');
}

function deleteSelected() {
  if (selectedCards.size === 0) return;
  for (const card of Array.from(selectedCards)) {
    hairGroup.remove(card);
  }
  tControls.detach();
  selectedCards.clear();
  selectedCard = null;
  clearSegmentHandles();
  refreshCardList();
  scheduleSave();
  pushHistory('delete');
}

function duplicateSelected() {
  if (selectedCards.size === 0) return;
  const newSelection = [];
  for (const c of selectedCards) {
    const clone = c.clone(true);
    clone.position.add(new THREE.Vector3(0.005, 0, 0));
    if (c.userData && c.userData.params) clone.userData.params = { ...c.userData.params };
    hairGroup.add(clone);
    newSelection.push(clone);
  }
  // Select the new clones
  selectedCards.clear();
  for (const n of newSelection) selectedCards.add(n);
  selectedCard = newSelection[newSelection.length - 1] || null;
  if (selectedCard && !placingEnabled) tControls.attach(selectedCard); else tControls.detach();
  refreshCardList();
  scheduleSave();
  pushHistory('duplicate');
}

function clearSelection() {
  selectedCards.clear();
  selectedCard = null;
  tControls.detach();
  updateTransformVisibility();
  resetRotationInputs();
  clearSegmentHandles();
}

function selectCard(card, additive = false) {
  if (!card) { clearSelection(); return; }
  if (additive) {
    if (selectedCards.has(card)) {
      selectedCards.delete(card);
      if (selectedCard === card) selectedCard = Array.from(selectedCards).pop() || null;
    } else {
      selectedCards.add(card);
      selectedCard = card; // make it primary
    }
  } else {
    selectedCards.clear();
    selectedCards.add(card);
    selectedCard = card;
  }
  if (placingEnabled || !selectedCard) tControls.detach();
  else tControls.attach(selectedCard);
  updateTransformVisibility();
  resetRotationInputs();
  // Always show selected card's points (handles); only draggable if Edit Segments enabled
  if (typeof segmentEdit !== 'undefined') {
    if (selectedCards.size === 1) buildSegmentHandles(selectedCard); else clearSegmentHandles();
  }
}

function alignSelectedToFaceNormal() {
  if (selectedCards.size === 0 || !currentModel) return;
  const from = new THREE.Vector3();
  const dirToModel = new THREE.Vector3();
  const modelPos = new THREE.Vector3();
  currentModel.getWorldPosition(modelPos);
  const base = new THREE.Vector3(0,0,1);
  for (const card of selectedCards) {
    card.getWorldPosition(from);
    dirToModel.subVectors(modelPos, from).normalize();
    raycaster.set(from, dirToModel);
    const hits = raycaster.intersectObject(currentModel, true);
    if (hits.length) {
      const n = hits[0].face.normal.clone();
      hits[0].object.localToWorld(n);
      const q = new THREE.Quaternion().setFromUnitVectors(base, n.normalize());
      card.quaternion.copy(q);
    }
  }
  scheduleSave();
  pushHistory('align');
}

// Loading models
const modelInput = document.getElementById('modelInput');
modelInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { await idbPut('model', file, { name: file.name, type: file.type }); } catch {}
  await loadModelFile(file);
  modelInput.value = '';
  scheduleSave();
});

async function loadModelFile(file) {
  unloadModel();
  const url = URL.createObjectURL(file);
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      currentModel = gltf.scene || gltf.scenes[0];
    } else if (name.endsWith('.obj')) {
      const loader = new OBJLoader();
      currentModel = await loader.loadAsync(url);
    } else if (name.endsWith('.fbx')) {
      const loader = new FBXLoader();
      currentModel = await loader.loadAsync(url);
    } else {
      alert('Unsupported format. Use .glb, .gltf, .obj, or .fbx');
      return;
    }
    postprocessImportedModel(currentModel);
    fitSceneToObject(currentModel);
    root.add(currentModel);
    updateModelOverlay();
  } catch (err) {
    console.error(err);
    alert('Failed to load model: ' + err.message);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function unloadModel() {
  if (currentModel) {
    root.remove(currentModel);
    currentModel = null;
  }
  clearModelOverlay();
}

function postprocessImportedModel(object) {
  let meshCount = 0;
  object.traverse((obj) => {
    if (obj.isMesh) {
      meshCount++;
      const g = obj.geometry;
      if (g && !g.attributes.normal) {
        g.computeVertexNormals();
      }
      const ensureMat = (m) => {
        if (!m) {
          return new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
        }
        // If it's a basic wireframe or black material, replace for visibility
        const needsReplace = (m.wireframe === true) || (m.color && m.color.r + m.color.g + m.color.b < 0.05 && !m.map);
        if (needsReplace) {
          return new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
        }
        m.side = THREE.DoubleSide;
        if (m.transparent && typeof m.opacity === 'number' && m.opacity === 0) {
          m.transparent = false;
          m.opacity = 1;
        }
        m.needsUpdate = true;
        return m;
      };
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(ensureMat);
      } else {
        obj.material = ensureMat(obj.material);
      }
    }
  });
  if (meshCount === 0) {
    console.warn('Imported object has no mesh primitives; OBJ may contain only lines/points.');
  }
}

// -------- Model overlay (edges / verts / normals) --------
let modelOverlayEntries = [];

function clearModelOverlay() {
  for (const entry of modelOverlayEntries) {
    if (entry && entry.parent) entry.parent.remove(entry);
    if (entry.userData && entry.userData._overlayDispose) {
      try { entry.userData._overlayDispose(); } catch {}
    }
  }
  modelOverlayEntries = [];
}

function updateModelOverlay() {
  clearModelOverlay();
  if (!currentModel) return;
  const mode = viewParams.overlayMode || 'Off';
  if (mode === 'Off') return;
  const normalsMax = 1000; // sample per mesh to keep it light
  // Collect mesh targets first to avoid mutating scene graph during traversal
  const targets = [];
  currentModel.traverse((o) => { if (o.isMesh && o.geometry && !o.userData?.__overlay) targets.push(o); });
  for (const obj of targets) {
    const g = obj.geometry;
    if (mode === 'Edges') {
      const wgeo = new THREE.WireframeGeometry(g);
      const mat = new THREE.LineBasicMaterial({ color: 0x6ea0ff, transparent: true, opacity: 0.6 });
      const wire = new THREE.LineSegments(wgeo, mat);
      wire.renderOrder = 2;
      wire.userData._overlayDispose = () => { wgeo.dispose(); mat.dispose(); };
      wire.userData.__overlay = true;
      obj.add(wire);
      modelOverlayEntries.push(wire);
    } else if (mode === 'Verts') {
      const pgeo = g.clone();
      const pmat = new THREE.PointsMaterial({ color: 0xffd54f, size: 3, sizeAttenuation: false });
      const pts = new THREE.Points(pgeo, pmat);
      pts.renderOrder = 2;
      pts.userData._overlayDispose = () => { pgeo.dispose(); pmat.dispose(); };
      pts.userData.__overlay = true;
      obj.add(pts);
      modelOverlayEntries.push(pts);
    } else if (mode === 'Normals') {
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      if (!pos || !nor) continue;
      const count = pos.count;
      const density = Math.max(1, Math.floor(viewParams.overlayNormalsDensity || 1));
      const stride = density; // sample every Nth vertex (1 = every vertex)
      const len = (viewParams.overlayNormalsLength || 0.03) * modelScale;
      const segments = Math.ceil(count / stride);
      // Build a single LineSegments of shafts for performance
      const lineGeo = new THREE.BufferGeometry();
      const arr = new Float32Array(segments * 2 * 3);
      let idx = 0;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);
      const worldToLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      const vLocal = new THREE.Vector3();
      const vWorld = new THREE.Vector3();
      const nWorld = new THREE.Vector3();
      const endWorld = new THREE.Vector3();
      const startLocal = new THREE.Vector3();
      const endLocal = new THREE.Vector3();
      for (let i = 0; i < count; i += stride) {
        vLocal.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        vWorld.copy(vLocal).applyMatrix4(obj.matrixWorld);
        nWorld.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(normalMatrix).normalize();
        endWorld.copy(vWorld).addScaledVector(nWorld, len);
        // convert world endpoints back to the object's local so the overlay follows transforms
        startLocal.copy(vWorld).applyMatrix4(worldToLocal);
        endLocal.copy(endWorld).applyMatrix4(worldToLocal);
        arr[idx++] = startLocal.x; arr[idx++] = startLocal.y; arr[idx++] = startLocal.z;
        arr[idx++] = endLocal.x;   arr[idx++] = endLocal.y;   arr[idx++] = endLocal.z;
      }
      lineGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const lineMat = new THREE.LineBasicMaterial({ color: 0x2196f3, linewidth: 1 });
      const lines = new THREE.LineSegments(lineGeo, lineMat);
      lines.renderOrder = 3;
      lines.userData._overlayDispose = () => { lineGeo.dispose(); lineMat.dispose(); };
      lines.userData.__overlay = true;
      obj.add(lines);
      modelOverlayEntries.push(lines);
    }
  }
}

function fitSceneToObject(obj) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  if (!box.isEmpty()) {
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    modelScale = maxDim || 1;
    const dist = maxDim * 2.0;
    const dir = new THREE.Vector3(0.6, 0.4, 1).normalize();
    camera.position.copy(center.clone().addScaledVector(dir, dist));
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }
}

// Texture input
const textureInput = document.getElementById('textureInput');
textureInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { idbPut('texture', file, { name: file.name, type: file.type }); } catch {}
  const url = URL.createObjectURL(file);
  const loader = new THREE.TextureLoader();
  loader.load(url, (tex) => {
    URL.revokeObjectURL(url);
    currentHairTexture = tex;
    sharedHairMaterial.map = currentHairTexture;
    sharedHairMaterial.needsUpdate = true;
    scheduleSave();
  }, undefined, (err) => {
    console.error(err);
    alert('Failed to load texture');
  });
});

// Export hair
document.getElementById('exportBtn').addEventListener('click', async () => {
  const dlg = document.getElementById('exportDialog');
  const fmtSel = document.getElementById('exportFormat');
  const gltfOpts = document.getElementById('gltfOptions');
  const fbxHint = document.getElementById('fbxHint');
  if (!dlg || !fmtSel) return;

  // Try to detect whether FBX exporter file exists (best-effort): show hint only when FBX selected
  const updateVis = () => {
    const fmt = fmtSel.value;
    gltfOpts.style.display = (fmt === 'gltf') ? 'flex' : 'none';
    fbxHint.style.display = (fmt === 'fbx') ? 'block' : 'none';
  };
  fmtSel.addEventListener('change', updateVis, { once: true });
  updateVis();

  dlg.showModal();

  const confirmBtn = document.getElementById('exportConfirmBtn');
  const onConfirm = async (e) => {
    e?.preventDefault?.();
    await performExportFromDialog();
    dlg.close();
    confirmBtn.removeEventListener('click', onConfirm);
  };
  confirmBtn.addEventListener('click', onConfirm);
});

async function performExportFromDialog() {
  if (hairGroup.children.length === 0) {
    alert('No hair cards to export.');
    return;
  }
  const fmt = /** @type {HTMLSelectElement} */(document.getElementById('exportFormat')).value;
  const onlySel = /** @type {HTMLInputElement} */(document.getElementById('exportOnlySelected')).checked;
  const onlyVisible = /** @type {HTMLInputElement} */(document.getElementById('exportOnlyVisible')).checked;
  const embedImages = /** @type {HTMLInputElement} */(document.getElementById('exportEmbedImages')).checked;

  const objToExport = buildExportObject(onlySel);

  if (fmt === 'glb') {
    const exporter = new GLTFExporter();
    exporter.parse(objToExport, (result) => {
      if (result instanceof ArrayBuffer) {
        saveArrayBuffer(result, 'hair_cards.glb');
      } else {
        const output = JSON.stringify(result, null, 2);
        saveString(output, 'hair_cards.gltf');
      }
    }, { binary: true, onlyVisible, embedImages: true });
  } else if (fmt === 'gltf') {
    const exporter = new GLTFExporter();
    exporter.parse(objToExport, (result) => {
      if (result instanceof ArrayBuffer) {
        // Should not happen for binary:false, but handle defensively
        saveArrayBuffer(result, 'hair_cards.glb');
      } else {
        const output = JSON.stringify(result, null, 2);
        saveString(output, 'hair_cards.gltf');
      }
    }, { binary: false, onlyVisible, embedImages });
  } else if (fmt === 'obj') {
    const objText = exportOBJ(objToExport, { onlyVisible });
    saveString(objText, 'hair_cards.obj');
  } else if (fmt === 'fbx') {
    try {
      const mod = await import('../vendor/three/examples/jsm/exporters/FBXExporter.js');
      const FBXExporter = mod.FBXExporter || (mod.default && mod.default.FBXExporter) || mod;
      const exporter = new FBXExporter();
      const result = exporter.parse(objToExport);
      if (result instanceof ArrayBuffer) {
        saveArrayBuffer(result, 'hair_cards.fbx');
      } else {
        saveString(result, 'hair_cards.fbx');
      }
    } catch (e) {
      console.warn('FBXExporter not found or failed to load.', e);
      alert('FBX export requires vendor/three/examples/jsm/exporters/FBXExporter.js. Please add it to the repo.');
    }
  }
}

function buildExportObject(onlySelected) {
  if (!onlySelected || selectedCards.size === 0) return hairGroup;
  const g = new THREE.Group();
  selectedCards.forEach((card) => {
    const clone = card.clone();
    clone.matrixWorld.copy(card.matrixWorld);
    clone.matrix.copy(card.matrix);
    clone.position.copy(card.position);
    clone.quaternion.copy(card.quaternion);
    clone.scale.copy(card.scale);
    g.add(clone);
  });
  return g;
}

// Minimal OBJ exporter for meshes under a given Object3D
function exportOBJ(object3D, opts = {}) {
  const onlyVisible = !!opts.onlyVisible;
  let output = '';
  let vertexOffset = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const uv = new THREE.Vector2();

  object3D.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    if (onlyVisible && node.visible === false) return;
    const geometry = node.geometry;
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr) return;
    const normalAttr = geometry.getAttribute('normal');
    const uvAttr = geometry.getAttribute('uv');

    node.updateWorldMatrix(true, false);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(node.matrixWorld);

    const vertCount = positionAttr.count;

    output += `o ${node.name || 'Mesh'}\n`;

    // Vertices
    for (let i = 0; i < vertCount; i++) {
      v.fromBufferAttribute(positionAttr, i).applyMatrix4(node.matrixWorld);
      output += `v ${v.x} ${v.y} ${v.z}\n`;
    }

    // UVs (optional)
    if (uvAttr) {
      for (let i = 0; i < uvAttr.count; i++) {
        uv.fromBufferAttribute(uvAttr, i);
        output += `vt ${uv.x} ${uv.y}\n`;
      }
    }

    // Normals (optional)
    if (normalAttr) {
      for (let i = 0; i < normalAttr.count; i++) {
        n.fromBufferAttribute(normalAttr, i).applyMatrix3(normalMatrix).normalize();
        output += `vn ${n.x} ${n.y} ${n.z}\n`;
      }
    }

    const index = geometry.getIndex();
    // Faces
    const faceHasUV = !!uvAttr;
    const faceHasNormal = !!normalAttr;

    const makeFace = (a, b, c) => {
      const ia = a + 1 + vertexOffset;
      const ib = b + 1 + vertexOffset;
      const ic = c + 1 + vertexOffset;
      if (faceHasUV && faceHasNormal) {
        output += `f ${ia}/${ia}/${ia} ${ib}/${ib}/${ib} ${ic}/${ic}/${ic}\n`;
      } else if (faceHasUV && !faceHasNormal) {
        output += `f ${ia}/${ia} ${ib}/${ib} ${ic}/${ic}\n`;
      } else if (!faceHasUV && faceHasNormal) {
        output += `f ${ia}//${ia} ${ib}//${ib} ${ic}//${ic}\n`;
      } else {
        output += `f ${ia} ${ib} ${ic}\n`;
      }
    };

    if (index) {
      const idx = index.array;
      for (let i = 0; i < idx.length; i += 3) {
        makeFace(idx[i], idx[i + 1], idx[i + 2]);
      }
    } else {
      // Assume triangles
      for (let i = 0; i < vertCount; i += 3) {
        makeFace(i, i + 1, i + 2);
      }
    }

    vertexOffset += vertCount;
  });

  return output;
}

function saveString(text, filename) {
  saveBlob(new Blob([text], { type: 'text/plain' }), filename);
}
function saveArrayBuffer(buffer, filename) {
  saveBlob(new Blob([buffer], { type: 'application/octet-stream' }), filename);
}
function saveBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Interaction: click to place or select
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  // Skip when manipulating the transform gizmo
  if (isTransformInteracting || tControls.dragging) return;
  // In Place mode: holding Alt enables orbiting, and prevents placement
  if (placingEnabled) {
    if (e.altKey) {
      controls.enabled = true;
      return; // let OrbitControls handle this interaction
    } else {
      controls.enabled = false; // prevent incidental orbiting while placing
    }
  }
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  if (placingEnabled) {
    if (!currentModel) return;
    const hits = raycaster.intersectObject(currentModel, true);
    if (!hits.length) return;
    const hit = hits[0];
    const scaledParams = {
      width: placeParams.width * modelScale,
      length: placeParams.length * modelScale,
      segments: placeParams.segments,
      curvature: placeParams.curvature,
      taper: placeParams.taper,
      offset: placeParams.offset * modelScale,
    };
    const card = createHairCard(scaledParams, sharedHairMaterial);
    // Orient card: align local +Z to surface normal
    const normal = hit.face.normal.clone();
    const worldNormal = normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), worldNormal);
    card.quaternion.copy(q);
    // Position slightly off the surface along normal
    const pos = hit.point.clone().addScaledVector(worldNormal, scaledParams.offset);
    card.position.copy(pos);
    hairGroup.add(card);
    if (!placingEnabled) selectCard(card);
    refreshCardList();
    scheduleSave();
    pushHistory('place');

    // Mirror placement if enabled
    if (placeParams.mirrorEnabled) {
      const axis = placeParams.mirrorAxis;
      const plane = placeParams.mirrorPlane;
      const mirroredPos = pos.clone();
      if (axis === 'X') mirroredPos.x = 2 * plane - pos.x;
      if (axis === 'Y') mirroredPos.y = 2 * plane - pos.y;
      if (axis === 'Z') mirroredPos.z = 2 * plane - pos.z;
      const mirroredNormal = worldNormal.clone();
      if (axis === 'X') mirroredNormal.x *= -1;
      if (axis === 'Y') mirroredNormal.y *= -1;
      if (axis === 'Z') mirroredNormal.z *= -1;
      mirroredNormal.normalize();
      const qMirror = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), mirroredNormal);
      // Avoid exact duplicate only if the mirrored pos is numerically identical
      const same = mirroredPos.distanceTo(pos) < 1e-7 && qMirror.angleTo(card.quaternion) < 1e-7;
      if (!same) {
        const mirrorCard = createHairCard(scaledParams, sharedHairMaterial);
        mirrorCard.quaternion.copy(qMirror);
        mirrorCard.position.copy(mirroredPos);
        hairGroup.add(mirrorCard);
        refreshCardList();
        scheduleSave();
        pushHistory('place-mirrored');
      }
    }
  } else {
    // If segment edit enabled, check handle hits first
    if (typeof segmentEdit !== 'undefined' && segmentEdit.enabled && segmentEdit.handlesGroup) {
      const handleHits = raycaster.intersectObjects(segmentEdit.handlesGroup.children, true);
      if (handleHits.length) {
        const hObj = handleHits[0].object;
        const handle = hObj.userData?.isSegmentHandle ? hObj : hObj.parent;
        if (handle && handle.userData?.isSegmentHandle) {
          selectSegmentHandle(handle);
          return;
        }
      }
    }
    // Select mode: pick hair card
    const hits = raycaster.intersectObjects(hairGroup.children, true);
    if (hits.length) {
      let m = hits[0].object;
      while (m && m.parent !== hairGroup && m !== hairGroup) m = m.parent;
      const additive = (e.ctrlKey || e.metaKey);
      selectCard(m, additive);
      refreshCardList();
    } else {
      // Clicked empty space; keep current selection intact
      // No-op to avoid losing selection when clicking off the model
      return;
    }
  }
});

renderer.domElement.addEventListener('pointerup', () => {
  // Restore controls state based on mode after interactions
  updateControlsEnabled();
});

// Keyboard controls
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key.toLowerCase() === 'd') duplicateSelected();
  if (e.key.toLowerCase() === 'w') setTransformMode('translate', true);
  if (e.key.toLowerCase() === 'e') setTransformMode('rotate', true);
  if (e.key.toLowerCase() === 'r') tControls.setMode('scale');
});

// Resize handling
function onResize() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}
window.addEventListener('resize', onResize);
onResize();
refreshCardList();
// Load any saved project state and assets
loadProjectFromStorage();

// Render loop
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------- Persistence ----------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 300);
}

function serializeCards() {
  return hairGroup.children.map(card => ({
    name: card.name,
    pos: card.position.toArray(),
    quat: card.quaternion.toArray(),
    scale: card.scale.toArray(),
    params: card.userData?.params || null,
  }));
}

function serializeSelection() {
  return Array.from(selectedCards).map(c => c.name);
}

function saveProject() {
  const floorObj = scene.getObjectByName('Floor');
  const data = {
    placeParams: {
      width: placeParams.width,
      length: placeParams.length,
      segments: placeParams.segments,
      curvature: placeParams.curvature,
      taper: placeParams.taper,
      offset: placeParams.offset,
      alphaTest: placeParams.alphaTest,
      doubleSided: placeParams.doubleSided,
      mirrorEnabled: placeParams.mirrorEnabled,
      mirrorAxis: placeParams.mirrorAxis,
      mirrorPlane: placeParams.mirrorPlane,
    },
    view: { showAxes: axes.visible, showGrid: grid.visible, showFloor: floorObj ? floorObj.visible : true, overlay: viewParams.overlayMode, overlayNormalsDensity: viewParams.overlayNormalsDensity, overlayNormalsLength: viewParams.overlayNormalsLength },
    cards: serializeCards(),
    selection: serializeSelection(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { console.warn('Save failed', e); }
}

async function loadProjectFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.placeParams) {
        Object.assign(placeParams, data.placeParams);
        updateAllMaterials({ alphaTest: placeParams.alphaTest, doubleSided: placeParams.doubleSided });
        updateMirrorVisual();
      }
      if (data.view) {
        axes.visible = !!data.view.showAxes;
        grid.visible = !!data.view.showGrid;
        const floorObj = scene.getObjectByName('Floor');
        if (floorObj) floorObj.visible = !!data.view.showFloor;
        if (data.view.overlay) viewParams.overlayMode = data.view.overlay;
        if (typeof data.view.overlayNormalsDensity === 'number') viewParams.overlayNormalsDensity = data.view.overlayNormalsDensity;
        if (typeof data.view.overlayNormalsLength === 'number') viewParams.overlayNormalsLength = data.view.overlayNormalsLength;
        updateModelOverlay();
      }
      // Restore cards
      while (hairGroup.children.length) hairGroup.remove(hairGroup.children[0]);
      if (Array.isArray(data.cards)) {
        for (const c of data.cards) {
          const p = c.params || { width: placeParams.width * modelScale, length: placeParams.length * modelScale, segments: placeParams.segments, curvature: placeParams.curvature, taper: placeParams.taper, offset: placeParams.offset * modelScale };
          const card = createHairCard(p, sharedHairMaterial);
          if (c.name) card.name = c.name;
          if (Array.isArray(c.pos)) card.position.fromArray(c.pos);
          if (Array.isArray(c.quat)) card.quaternion.fromArray(c.quat);
          if (Array.isArray(c.scale)) card.scale.fromArray(c.scale);
          hairGroup.add(card);
        }
        // Restore selection by name
        selectedCards.clear();
        selectedCard = null;
        if (Array.isArray(data.selection)) {
          const want = new Set(data.selection);
          for (const card of hairGroup.children) {
            if (want.has(card.name)) {
              selectedCards.add(card);
              selectedCard = card; // last wins
            }
          }
          if (!placingEnabled && selectedCard) tControls.attach(selectedCard); else tControls.detach();
          if (selectedCard) buildSegmentHandles(selectedCard); else clearSegmentHandles();
        }
        refreshCardList();
      }
    }
  } catch (e) { console.warn('Load project error', e); }

  // Try to restore model and texture from IndexedDB
  try {
    const recModel = await idbGet('model');
    if (recModel && recModel.blob && recModel.meta?.name) {
      const file = new File([recModel.blob], recModel.meta.name, { type: recModel.meta.type || '' });
      await loadModelFile(file);
    }
  } catch (e) { console.warn('Model restore failed', e); }

  try {
    const recTex = await idbGet('texture');
    if (recTex && recTex.blob) {
      const url = URL.createObjectURL(recTex.blob);
      const loader = new THREE.TextureLoader();
      await new Promise((resolve, reject) => {
        loader.load(url, (tex) => { currentHairTexture = tex; sharedHairMaterial.map = tex; sharedHairMaterial.needsUpdate = true; URL.revokeObjectURL(url); resolve(); }, undefined, (err) => { URL.revokeObjectURL(url); reject(err); });
      });
    }
  } catch (e) { console.warn('Texture restore failed', e); }

  // After loading, ensure we have an initial history state
  pushHistory('init');
}

// ---------- Segment Editing ----------
const segmentEdit = { enabled: false, handlesGroup: null, activeCard: null, activeHandle: null };

function computeBaseRowCenterLocal(params, rowIndex) {
  const length = params.length;
  const segments = Math.max(1, params.segments);
  const curvature = params.curvature;
  const t = rowIndex / segments; // 0..1 from root to tip
  const yGeo = length * 0.5 - t * length; // geometry space
  const zBase = curvature * (t * t) * length;
  // Convert to card local by adding mesh.position (0, -length/2, 0)
  const yLocal = yGeo - length * 0.5;
  return new THREE.Vector3(0, yLocal, zBase);
}

function clearSegmentHandles() {
  if (segmentEdit.handlesGroup && segmentEdit.handlesGroup.parent) {
    segmentEdit.handlesGroup.parent.remove(segmentEdit.handlesGroup);
  }
  segmentEdit.handlesGroup = null;
  segmentEdit.activeCard = null;
  segmentEdit.activeHandle = null;
  if (tControls.object && tControls.object.userData?.isSegmentHandle) tControls.detach();
}

function buildSegmentHandles(card) {
  clearSegmentHandles();
  if (!card) return;
  const mesh = getCardMesh(card);
  const p = card.userData?.params;
  if (!mesh || !p) return;
  const rows = Math.max(1, p.segments) + 1;
  const group = new THREE.Group();
  group.name = 'SegmentHandles';
  group.renderOrder = 10000;
  const radius = 0.005 * modelScale;
  const geom = new THREE.SphereGeometry(radius, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false, depthWrite: false, transparent: true });
  for (let r = 0; r < rows; r++) {
    const h = new THREE.Mesh(geom, mat.clone());
    h.userData.isSegmentHandle = true;
    h.userData.rowIndex = r;
    h.userData.card = card;
    h.userData.initialLocal = null;
    h.userData.initialOffset = null;
    // Position at current row center (base + offset)
    const base = computeBaseRowCenterLocal(p, r);
    const off = Array.isArray(p.segmentOffsets?.[r]) ? p.segmentOffsets[r] : [0,0,0];
    const local = new THREE.Vector3(base.x + off[0], base.y + off[1], base.z + off[2]);
    const world = local.clone();
    card.localToWorld(world);
    h.position.copy(world);
    // Align handle orientation to card's world orientation
    card.getWorldQuaternion(h.quaternion);
    group.add(h);
  }
  // Add to scene root to avoid parent transform issues
  scene.add(group);
  segmentEdit.handlesGroup = group;
  segmentEdit.activeCard = card;
}

function selectSegmentHandle(handle) {
  if (!handle || !handle.userData?.isSegmentHandle) return;
  segmentEdit.activeHandle = handle;
  setTransformMode('translate', true);
  tControls.setSpace('local');
  // Capture initial local position and offset to compute deltas during drag
  const card = handle.userData.card || segmentEdit.activeCard;
  if (card) {
    const p = card.userData?.params;
    const row = handle.userData.rowIndex || 0;
    const wpos = new THREE.Vector3(); handle.getWorldPosition(wpos);
    const lpos = wpos.clone(); card.worldToLocal(lpos);
    handle.userData.initialLocal = lpos.clone();
    handle.userData.initialOffset = Array.isArray(p?.segmentOffsets?.[row]) ? [...p.segmentOffsets[row]] : [0,0,0];
  } else {
    handle.userData.initialLocal = null;
    handle.userData.initialOffset = null;
  }
  tControls.attach(handle);
}

// Live update geometry while dragging a handle or card
tControls.addEventListener('objectChange', () => {
  const obj = tControls.object;
  if (!obj) return;
  // Handle dragging: update offset using initial-local delta
  if (obj.userData?.isSegmentHandle) {
    const card = obj.userData.card || segmentEdit.activeCard;
    if (!card) return;
    const p = card.userData?.params;
    const mesh = getCardMesh(card);
    if (!p || !mesh) return;
    const row = obj.userData.rowIndex || 0;
    const worldPos = new THREE.Vector3(); obj.getWorldPosition(worldPos);
    const localPos = worldPos.clone(); card.worldToLocal(localPos);
    const initLocal = obj.userData.initialLocal || localPos.clone();
    const initOffset = obj.userData.initialOffset || (Array.isArray(p.segmentOffsets?.[row]) ? p.segmentOffsets[row] : [0,0,0]);
    const dx = localPos.x - initLocal.x;
    const dy = localPos.y - initLocal.y;
    const dz = localPos.z - initLocal.z;
    const newOff = [ (initOffset[0] || 0) + dx, (initOffset[1] || 0) + dy, (initOffset[2] || 0) + dz ];
    if (!Array.isArray(p.segmentOffsets) || p.segmentOffsets.length !== Math.max(1, p.segments)+1) {
      p.segmentOffsets = Array.from({ length: Math.max(1, p.segments)+1 }, () => [0,0,0]);
    }
    p.segmentOffsets[row] = newOff;
    // Apply to geometry row immediately
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const rows = Math.max(1, p.segments) + 1;
    if (row >= 0 && row < rows) {
      const i0 = row * 2;
      const i1 = row * 2 + 1;
      const t = row / Math.max(1, p.segments);
      const yGeo = p.length * 0.5 - t * p.length;
      const bend = p.curvature * (t * t) * p.length;
      const taperW = THREE.MathUtils.lerp(1, p.taper, t);
      const xL = (-p.width * 0.5) * taperW;
      const xR = (+p.width * 0.5) * taperW;
    const yLocal = yGeo - p.length * 0.5; // card-local reference for handle placement
    const ox = newOff[0], oy = newOff[1], oz = newOff[2];
    // Geometry vertices live in mesh-local (geometry) space where Y is yGeo
    pos.setXYZ(i0, xL + ox, yGeo + oy, bend + oz);
    pos.setXYZ(i1, xR + ox, yGeo + oy, bend + oz);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // Snap handle to the exact new row center in card-local space
    const base = new THREE.Vector3(0, yLocal, bend);
    const centerLocal = base.add(new THREE.Vector3(ox, oy, oz));
    const centerWorld = centerLocal.clone(); card.localToWorld(centerWorld);
    obj.position.copy(centerWorld);
    }
    return;
  }
  // Card dragging: keep handles synced in world space
  if (segmentEdit.activeCard && obj === segmentEdit.activeCard) {
    updateSegmentHandlesWorldPositions(segmentEdit.activeCard);
  }
});

function updateSegmentHandlesWorldPositions(card) {
  if (!segmentEdit.handlesGroup || !card) return;
  const p = card.userData?.params;
  if (!p) return;
  const rows = Math.max(1, p.segments) + 1;
  for (const h of segmentEdit.handlesGroup.children) {
    if (!h.userData?.isSegmentHandle) continue;
    const r = h.userData.rowIndex || 0;
    if (r < 0 || r >= rows) continue;
    const base = computeBaseRowCenterLocal(p, r);
    const off = Array.isArray(p.segmentOffsets?.[r]) ? p.segmentOffsets[r] : [0,0,0];
    const local = new THREE.Vector3(base.x + off[0], base.y + off[1], base.z + off[2]);
    const world = local.clone(); card.localToWorld(world);
    h.position.copy(world);
    card.getWorldQuaternion(h.quaternion);
  }
}

tControls.addEventListener('mouseUp', () => {
  if (segmentEdit.activeHandle && segmentEdit.activeHandle.userData?.isSegmentHandle) {
    scheduleSave();
    pushHistory('segment-move');
  }
});

// UI: toggle segment edit in Selected Card folder
const segEditParams = { editSegments: false };
selectedFolder.add(segEditParams, 'editSegments').name('Edit Segments').onChange(v => {
  segmentEdit.enabled = !!v;
  if (segmentEdit.enabled && selectedCards.size === 1) {
    buildSegmentHandles(selectedCard);
  } else {
    clearSegmentHandles();
  }
});

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('FHToolDB', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, blob, meta = {}) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').put({ blob, meta, time: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readonly');
    const req = tx.objectStore('assets').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- History (Undo) ----------
function captureStateForHistory() {
  const floorObj = scene.getObjectByName('Floor');
  return {
    placeParams: { ...placeParams },
    view: { showAxes: axes.visible, showGrid: grid.visible, showFloor: floorObj ? floorObj.visible : true, overlay: viewParams.overlayMode },
    cards: serializeCards(),
  };
}

function applyHistoryState(state) {
  if (!state) return;
  isRestoringHistory = true;
  try {
    // Restore params and view
    Object.assign(placeParams, state.placeParams || {});
    updateAllMaterials({ alphaTest: placeParams.alphaTest, doubleSided: placeParams.doubleSided });
    if (state.view) {
      axes.visible = !!state.view.showAxes;
      grid.visible = !!state.view.showGrid;
      const floorObj = scene.getObjectByName('Floor');
      if (floorObj) floorObj.visible = !!state.view.showFloor;
      if (state.view.overlay) viewParams.overlayMode = state.view.overlay;
      updateModelOverlay();
    }
    // Restore cards
    while (hairGroup.children.length) hairGroup.remove(hairGroup.children[0]);
    if (Array.isArray(state.cards)) {
      for (const c of state.cards) {
        const p = c.params || { width: placeParams.width * modelScale, length: placeParams.length * modelScale, segments: placeParams.segments, curvature: placeParams.curvature, taper: placeParams.taper, offset: placeParams.offset * modelScale };
        const card = createHairCard(p, sharedHairMaterial);
        if (c.name) card.name = c.name;
        if (Array.isArray(c.pos)) card.position.fromArray(c.pos);
        if (Array.isArray(c.quat)) card.quaternion.fromArray(c.quat);
        if (Array.isArray(c.scale)) card.scale.fromArray(c.scale);
        hairGroup.add(card);
      }
    }
    selectedCards.clear();
    selectedCard = null;
    tControls.detach();
    clearSegmentHandles();
    refreshCardList();
    scheduleSave();
  } finally {
    isRestoringHistory = false;
  }
}

function pushHistory(_label) {
  if (isRestoringHistory) return;
  const state = captureStateForHistory();
  // If pointer not at end, drop redo branch
  if (historyPtr < history.length - 1) history.splice(historyPtr + 1);
  history.push(state);
  if (history.length > HISTORY_LIMIT) history.shift();
  historyPtr = history.length - 1;
  updateUndoButtonState();
}

function canUndo() { return historyPtr > 0; }

function undo() {
  if (!canUndo()) return;
  historyPtr -= 1;
  const state = history[historyPtr];
  applyHistoryState(state);
  updateUndoButtonState();
}

function updateUndoButtonState() {
  if (!undoBtn) return;
  undoBtn.disabled = !canUndo();
  undoBtn.classList.toggle('disabled', undoBtn.disabled);
}

undoBtn?.addEventListener('click', () => undo());

// ---- Live edit helpers ----
function getCardMesh(card) {
  if (!card) return null;
  for (const ch of card.children) if (ch.isMesh) return ch;
  return null;
}

function rebuildCardGeometry(card, newParamsPartial = {}) {
  if (!card) return;
  const p = card.userData?.params ? { ...card.userData.params, ...newParamsPartial } : null;
  if (!p) return;
  const mesh = getCardMesh(card);
  if (!mesh) return;
  const oldGeo = mesh.geometry;
  p.segments = Math.max(1, Math.round(p.segments || 1));
  // Ensure segmentOffsets length matches segments+1; if mismatch, reset to zeros
  const rows = p.segments + 1;
  if (!Array.isArray(p.segmentOffsets) || p.segmentOffsets.length !== rows) {
    p.segmentOffsets = Array.from({ length: rows }, () => [0, 0, 0]);
  }
  const newGeo = createHairCardGeometry(p.width, p.length, p.segments, p.curvature, p.taper, p.segmentOffsets);
  mesh.geometry = newGeo;
  mesh.position.y = -p.length / 2;
  if (oldGeo && oldGeo.dispose) oldGeo.dispose();
  card.userData.params = p;
  scheduleSave();
  // geometry edit is a history state change; push after rebuild
  pushHistory('rebuild');
  // If segment edit is active on this card, rebuild its handles to match
  if (typeof segmentEdit !== 'undefined' && segmentEdit.enabled && segmentEdit.activeCard === card) {
    buildSegmentHandles(card);
  }
}

function updateSelectedCardsParam(key, value) {
  if (selectedCards.size === 0) return;
  for (const card of selectedCards) {
    const p = card.userData?.params;
    if (!p) continue;
    if (key === 'offset') {
      const old = p.offset || 0;
      const delta = (value - old);
      const dir = new THREE.Vector3(0,0,1).applyQuaternion(card.quaternion).normalize();
      card.position.addScaledVector(dir, delta);
      card.userData.params.offset = value;
    } else {
      const patch = {}; patch[key] = value;
      rebuildCardGeometry(card, patch);
    }
  }
  scheduleSave();
  // For offset we didn't call rebuild; still record a history point
  if (key === 'offset') pushHistory('offset');
}
function updateControlsEnabled() {
  // In Place mode, disable orbit unless Alt is held on pointerdown
  controls.enabled = !placingEnabled;
}
