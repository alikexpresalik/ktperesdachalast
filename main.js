import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// --- ИСХОДНЫЕ ССЫЛКИ НА ТВОЙ ПЕРВЫЙ РЕПОЗИТОРИЙ ---
const MODEL_SOURCES = {
    cnek: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/cnek.obj',
    mug: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/teamugobj.obj',
    watch: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/handwatch.fbx',
    plantObj: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/indoor%20plant_02.obj',
    plantCol: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/indoor%20plant_2_COL.jpg',
    plantNor: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/indoor%20plant_2_NOR.jpg',
    plantVl: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/indoor%20plant_2_vl.jpg',
    koltuk: 'https://github.com/alikexpresalik/k2peresdatcha/blob/main/Koltuk.obj'
};

// Функция-резолвер: превращает HTML-просмотрщик GitHub в прямой файл с заголовками CORS
function resolveGithubUrl(url) {
    if (!url) return '';
    return url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
}

// --- СЦЕНА, РЕНДЕР И КАМЕРА ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c10);
scene.fog = new THREE.FogExp2(0x0a0c10, 0.02);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 + 0.02; // Пол не пробиваем
controls.minDistance = 2;
controls.maxDistance = 25;

// Если юзер крутит мышкой камеру, отменяем программную анимацию
let isTransitioning = false;
controls.addEventListener('start', () => { isTransitioning = false; });

// --- СВЕТ ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(8, 16, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6366f1, 1.2);
rimLight.position.set(-10, 6, -10);
scene.add(rimLight);

// Пол и технологичная сетка
const grid = new THREE.GridHelper(30, 30, 0x38bdf8, 0x1e293b);
grid.position.y = -0.01;
scene.add(grid);

const floorGeo = new THREE.PlaneGeometry(60, 60);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x07090e, roughness: 0.9, metalness: 0.1 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// --- СОСТОЯНИЕ И РЕЕСТР МОДЕЛЕЙ ---
const models = {};
const interactiveMeshes = [];
let autoRotate = true;
let wireframeActive = false;
let selectedModelId = null;

const camTarget = {
    pos: new THREE.Vector3(0, 5, 14),
    look: new THREE.Vector3(0, 1.5, 0)
};

// Функция очистки кривых моделей от мусорных софтбоксов и фонов
function cleanModel(model, fallbackColor, isPlant = false) {
    const toRemove = [];

    model.traverse((child) => {
        if (child.isMesh) {
            const name = (child.name || '').toLowerCase();
            if (name.includes('plane') || name.includes('floor') || name.includes('ground') || 
                name.includes('studio') || name.includes('backdrop') || name.includes('light') || 
                name.includes('camera')) {
                toRemove.push(child);
                return;
            }

            if (child.geometry) {
                child.geometry.computeVertexNormals();
                child.geometry.computeBoundingBox();
                const box = child.geometry.boundingBox;
                const size = new THREE.Vector3();
                box.getSize(size);
                
                if (size.y < 0.05 && (size.x > 4 || size.z > 4)) {
                    toRemove.push(child);
                    return;
                }
            }

            child.castShadow = true;
            child.receiveShadow = true;

            if (!isPlant) {
                child.material = new THREE.MeshStandardMaterial({
                    color: fallbackColor,
                    roughness: 0.45,
                    metalness: 0.15,
                    side: THREE.DoubleSide
                });
            }
        }
    });

    toRemove.forEach((m) => { if (m.parent) m.parent.remove(m); });
}

// Нормализация масштаба и центрирование
function normalizeModel(model, targetSize, posX, posZ) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0) {
        const scale = targetSize / maxDim;
        model.scale.set(scale, scale, scale);
    }

    const updatedBox = new THREE.Box3().setFromObject(model);
    model.position.set(posX, -updatedBox.min.y, posZ);
}

function registerModel(id, obj, title, desc) {
    obj.userData = { id, title, desc };
    models[id] = obj;

    obj.traverse((child) => {
        if (child.isMesh) {
            child.userData.rootId = id;
            interactiveMeshes.push(child);
        }
    });

    scene.add(obj);
    setStatus(`Загружено из внешнего репозитория: ${title}`);
}

// --- ЗАГРУЗКА 5 МОДЕЛЕЙ ЧЕРЕЗ URL ---
const objLoader = new OBJLoader();
const fbxLoader = new FBXLoader();
const textureLoader = new THREE.TextureLoader();

// 1. CNEK (Центр)
objLoader.load(resolveGithubUrl(MODEL_SOURCES.cnek), (obj) => {
    let maxVerts = 0;
    const toRemove = [];

    obj.traverse((child) => {
        if (child.isMesh && child.geometry && child.geometry.attributes.position) {
            maxVerts = Math.max(maxVerts, child.geometry.attributes.position.count);
        }
    });

    obj.traverse((child) => {
        if (child.isMesh) {
            const name = child.name.toLowerCase();
            const count = child.geometry && child.geometry.attributes.position ? child.geometry.attributes.position.count : 0;
            if (name.includes('box') || name.includes('tent') || name.includes('roof') || 
                name.includes('reflector') || name.includes('softbox') || 
                (maxVerts > 0 && count < maxVerts * 0.25)) {
                toRemove.push(child);
            }
        }
    });
    toRemove.forEach((m) => { if (m.parent) m.parent.remove(m); });

    cleanModel(obj, 0x8b5cf6);
    normalizeModel(obj, 2.0, 0, 0);
    registerModel('cnek', obj, 'Скульптура Cnek', 'Фильтрация софтбоксов и студийных паразитов прошла успешно.');
});

// 2. КРУЖКА (Справа)
objLoader.load(resolveGithubUrl(MODEL_SOURCES.mug), (obj) => {
    cleanModel(obj, 0x06b6d4);
    normalizeModel(obj, 1.2, 2.6, 1.6);
    registerModel('mug', obj, 'Керамическая кружка', 'OBJ импорт из репозитория k2peresdatcha.');
});

// 3. ЧАСЫ (Дальний правый угол)
fbxLoader.load(resolveGithubUrl(MODEL_SOURCES.watch), (fbx) => {
    cleanModel(fbx, 0xf59e0b);
    normalizeModel(fbx, 1.3, 4.8, -0.6);
    registerModel('watch', fbx, 'Наручные часы (FBX)', 'Бинарный FBX импорт с внешнего источника.');
});

// 4. КОМНАТНОЕ РАСТЕНИЕ С PBR-ТЕКСТУРАМИ (Дальний левый угол)
const plantColorMap = textureLoader.load(resolveGithubUrl(MODEL_SOURCES.plantCol));
plantColorMap.colorSpace = THREE.SRGBColorSpace;
const plantNormalMap = textureLoader.load(resolveGithubUrl(MODEL_SOURCES.plantNor));
const plantRoughMap = textureLoader.load(resolveGithubUrl(MODEL_SOURCES.plantVl));

const plantMat = new THREE.MeshStandardMaterial({
    map: plantColorMap,
    normalMap: plantNormalMap,
    roughnessMap: plantRoughMap,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide,
    alphaTest: 0.25
});

objLoader.load(resolveGithubUrl(MODEL_SOURCES.plantObj), (obj) => {
    cleanModel(obj, 0xffffff, true);
    obj.traverse((child) => {
        if (child.isMesh) child.material = plantMat;
    });
    normalizeModel(obj, 2.4, -4.8, -0.6);
    registerModel('plant', obj, 'Комнатное растение', 'Текстурированный PBR-меш с NormalMap и Albedo.');
});

// 5. КРЕСЛО KOLTUK (Слева)
objLoader.load(resolveGithubUrl(MODEL_SOURCES.koltuk), (obj) => {
    cleanModel(obj, 0xef4444);
    normalizeModel(obj, 2.0, -2.6, 1.6);
    registerModel('koltuk', obj, 'Кресло Koltuk', 'OBJ модель мебели, отмасштабирована в размер сцены.');
});

// --- RAYCASTER (КЛИКИ И ХОВЕРЫ) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredMesh = null;

function applyEmissive(mesh, hex) {
    if (!mesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
        if (m && m.emissive) m.emissive.setHex(hex);
    });
}

window.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(interactiveMeshes, false);

    if (hits.length > 0) {
        document.body.style.cursor = 'pointer';
        const hit = hits[0].object;
        if (hoveredMesh !== hit) {
            applyEmissive(hoveredMesh, 0x000000);
            hoveredMesh = hit;
            applyEmissive(hoveredMesh, 0x2563eb);
        }
    } else {
        document.body.style.cursor = 'default';
        if (hoveredMesh) {
            applyEmissive(hoveredMesh, 0x000000);
            hoveredMesh = null;
        }
    }
});

window.addEventListener('click', () => {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(interactiveMeshes, false);
    if (hits.length > 0) {
        focusOnModel(hits[0].object.userData.rootId);
    }
});

// --- УПРАВЛЕНИЕ КАМЕРОЙ И UI ---
export function focusOnModel(id) {
    if (!id || id === 'all') {
        selectedModelId = null;
        camTarget.pos.set(0, 5, 14);
        camTarget.look.set(0, 1.5, 0);
        isTransitioning = true;
        setCard('Шоурум', 'Все 5 моделей загружаются напрямую с внешнего GitHub-репозитория.');
        return;
    }

    const model = models[id];
    if (!model) return;

    selectedModelId = id;
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());

    camTarget.look.copy(center);
    camTarget.pos.set(center.x, center.y + 1.2, center.z + 4.0);
    isTransitioning = true;

    setCard(model.userData.title, model.userData.desc);
}

window.selectModel = focusOnModel;

window.toggleRotation = () => {
    autoRotate = !autoRotate;
    const btn = document.getElementById('rot-btn');
    if (btn) btn.innerText = autoRotate ? 'Автовращение: ВКЛ' : 'Автовращение: ВЫКЛ';
};

window.toggleWireframe = () => {
    wireframeActive = !wireframeActive;
    scene.traverse((child) => {
        if (child.isMesh && child !== floor) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { if (m) m.wireframe = wireframeActive; });
        }
    });
};

window.setLightingPreset = (type) => {
    if (type === 'studio') {
        scene.background.set(0x0a0c10);
        scene.fog.color.set(0x0a0c10);
        keyLight.color.set(0xffffff);
        rimLight.color.set(0x6366f1);
    } else if (type === 'cyber') {
        scene.background.set(0x090114);
        scene.fog.color.set(0x090114);
        keyLight.color.set(0xec4899);
        rimLight.color.set(0x06b6d4);
    } else if (type === 'minimal') {
        scene.background.set(0xf1f5f9);
        scene.fog.color.set(0xf1f5f9);
        keyLight.color.set(0xffedd5);
        rimLight.color.set(0x94a3b8);
        floorMat.color.set(0xe2e8f0);
    }
};

window.changeColor = (hex) => {
    if (!selectedModelId || !models[selectedModelId]) return;
    const m = models[selectedModelId];
    m.traverse((child) => {
        if (child.isMesh && child.material && child.material !== plantMat) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => mat.color.set(hex));
        }
    });
};

function setCard(title, text) {
    const el = document.getElementById('info-card');
    if (el) el.innerHTML = `<h3>${title}</h3><p>${text}</p>`;
}

function setStatus(msg) {
    const el = document.getElementById('status-hud');
    if (el) el.innerText = msg;
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ГЛАВНЫЙ ЦИКЛ ---
function animate() {
    requestAnimationFrame(animate);

    if (isTransitioning) {
        camera.position.lerp(camTarget.pos, 0.05);
        controls.target.lerp(camTarget.look, 0.05);
        if (camera.position.distanceTo(camTarget.pos) < 0.04 && controls.target.distanceTo(camTarget.look) < 0.04) {
            isTransitioning = false;
        }
    }

    if (autoRotate) {
        if (models.watch) models.watch.rotation.y += 0.012;
        if (models.mug) models.mug.rotation.y += 0.008;
        if (models.cnek) models.cnek.rotation.y += 0.005;
        if (models.koltuk) models.koltuk.rotation.y -= 0.006;
        if (models.plant) models.plant.rotation.y += 0.004;
    }

    controls.update();
    renderer.render(scene, camera);
}

animate();