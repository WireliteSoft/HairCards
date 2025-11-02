Facial Hair Cards Tool (Web)

Overview
- Browser-based tool to load a 3D head model and place “hair cards” (curved planes with alpha texture) for facial hair prototyping.
- Built with Three.js via CDN; no build step required.

Getting Started
1. Ensure the folder is served by your web server (e.g., XAMPP):
   - Place this repo under your htdocs, then open http://localhost/FacialHairTool/ in a browser.
2. Click “Load Model” and choose a .glb/.gltf/.obj/.fbx file of your head mesh.
3. (Optional) Click “Hair Texture” to load a custom alpha texture; a default procedural texture is provided.
4. Use left-click in “Place” mode to place cards on the surface; switch to “Select” mode to select/edit.

Controls
- LMB: Place or select depending on mode
- W/E/R: Translate / Rotate / Scale (Transform controls)
- D: Duplicate selected card
- Delete/Backspace: Delete selected card
- GUI (right side): Tweak width, length, segments, curvature, taper, alpha test, double-sided
- Export Hair (GLB): Exports only the hair cards as a GLB file

Notes
- Supported formats: GLB/GLTF (recommended), OBJ, FBX (materials may vary).
- The app pulls Three.js and loaders from a CDN; internet is required for those scripts in the browser.
- Exported GLB contains the hair cards group (geometry + current texture embedded).

Files
- index.html – App shell and topbar UI
- css/style.css – Basic styling
- js/main.js – Three.js scene, loaders, interaction, hair card generation

Troubleshooting
- If the canvas is blank: open DevTools (F12) and check Console for any loading errors (e.g., blocked CDN, CORS).
- If model loads tiny or huge: the app auto-frames on load but you can manually reposition the camera with OrbitControls.
- For best results: use triangulated, reasonably scaled head meshes and hair textures with alpha.

