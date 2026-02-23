'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { TerrainType, WORLD_SIZE } from '@/lib/types';
import {
  clamp,
  computeTerrainCounts,
  deserializeWorldFromBase64,
  extractTileWindow,
  generateSeededWorld,
  getSymmetryPoints,
  indexToTerrain,
  serializeWorldToBase64,
  terrainToIndex,
  tileIndex,
  WORLD_DESIGNER_TERRAINS,
  WORLD_DESIGNER_TERRAIN_COLORS as TERRAIN_COLORS,
  WORLD_TILE_COUNT,
  WorldDesignerSymmetryMode,
} from '@/lib/world-designer';
import { WorldDesigner3DPreview } from '@/components/world-designer/WorldDesigner3DPreview';

type EditorTool = 'brush' | 'replace' | 'rectangle' | 'bucket' | 'eyedropper';

interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

interface WorldDesignerSnapshot {
  id: string;
  name: string;
  createdAt: string;
  seed: number;
  worldBase64: string;
}

interface MutableOperation {
  label: string;
  previous: Map<number, number>;
  next: Map<number, number>;
}

interface StoredOperation {
  label: string;
  indices: number[];
  previous: number[];
  next: number[];
}

interface InteractionState {
  mode: 'none' | 'pan' | 'paint' | 'rectangle';
  pointerId: number | null;
  startClientX: number;
  startClientY: number;
  startViewX: number;
  startViewY: number;
  lastTileX: number;
  lastTileY: number;
}

interface CanvasProjection {
  canvasWidth: number;
  canvasHeight: number;
  srcX: number;
  srcY: number;
  srcWidth: number;
  srcHeight: number;
  destX: number;
  destY: number;
  destWidth: number;
  destHeight: number;
  zoom: number;
}

const STORAGE_KEY = 'clawcity-world-designer-snapshots-v1';
const MAX_SNAPSHOTS = 10;
const MAX_HISTORY = 160;
const MAX_ZOOM = 28;
const MIN_ZOOM_FLOOR = 0.35;
const PREVIEW_RADIUS = 26;
const ZOOM_STEP_FACTOR = 1.08;
const ZOOM_SETTLE_EPSILON = 0.001;
const PREVIEW_FOLLOW_SYNC_MS = 160;
const BRUSH_SIZES = [1, 3, 5, 9] as const;
const TERRAIN_SHORTCUTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

const TOOL_OPTIONS: Array<{ id: EditorTool; label: string; help: string }> = [
  { id: 'brush', label: 'Brush', help: 'Paint selected terrain on drag.' },
  { id: 'replace', label: 'Replace', help: 'Only repaint the terrain under first click.' },
  { id: 'rectangle', label: 'Rectangle', help: 'Drag to fill a rectangle area.' },
  { id: 'bucket', label: 'Bucket', help: 'Flood-fill connected region.' },
  { id: 'eyedropper', label: 'Eyedropper', help: 'Pick terrain from tile.' },
];

function randomSeed(): number {
  return Math.floor(Math.random() * 900_000_000) + 100_000_000;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

function parseSnapshots(input: unknown): WorldDesignerSnapshot[] {
  if (!Array.isArray(input)) return [];
  const parsed: WorldDesignerSnapshot[] = [];

  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const value = row as Partial<WorldDesignerSnapshot>;
    if (
      typeof value.id !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.createdAt !== 'string' ||
      typeof value.seed !== 'number' ||
      typeof value.worldBase64 !== 'string'
    ) {
      continue;
    }
    parsed.push({
      id: value.id,
      name: value.name,
      createdAt: value.createdAt,
      seed: Math.floor(value.seed),
      worldBase64: value.worldBase64,
    });
  }

  return parsed.slice(0, MAX_SNAPSHOTS);
}

function nowIso(): string {
  return new Date().toISOString();
}

export default function WorldDesignerPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [seed, setSeed] = useState<number>(() => randomSeed());
  const worldRef = useRef<Uint8Array>(generateSeededWorld(seed));
  const countsRef = useRef<number[]>(computeTerrainCounts(worldRef.current));

  const [terrainCounts, setTerrainCounts] = useState<number[]>(countsRef.current);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [tool, setTool] = useState<EditorTool>('brush');
  const [selectedTerrainIndex, setSelectedTerrainIndex] = useState(terrainToIndex('plains'));
  const [brushSize, setBrushSize] = useState<(typeof BRUSH_SIZES)[number]>(3);
  const [symmetry, setSymmetry] = useState<WorldDesignerSymmetryMode>('off');
  const [showGrid, setShowGrid] = useState(true);

  const [viewState, setViewState] = useState<ViewState>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const viewStateRef = useRef<ViewState>(viewState);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 680 });
  const hasInitializedViewRef = useRef(false);

  const [followPreviewCenter, setFollowPreviewCenter] = useState(true);
  const [followedPreviewCenter, setFollowedPreviewCenter] = useState({
    x: Math.floor(WORLD_SIZE / 2),
    y: Math.floor(WORLD_SIZE / 2),
  });
  const [manualPreviewCenter, setManualPreviewCenter] = useState({
    x: Math.floor(WORLD_SIZE / 2),
    y: Math.floor(WORLD_SIZE / 2),
  });
  const [isPreviewPickMode, setIsPreviewPickMode] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(
    'This world is randomly generated. You can build on top of it.'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [snapshots, setSnapshots] = useState<WorldDesignerSnapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [exportJson, setExportJson] = useState('');
  const [importJson, setImportJson] = useState('');

  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rgbPaletteRef = useRef<Array<[number, number, number]>>(
    WORLD_DESIGNER_TERRAINS.map((terrain) => hexToRgb(TERRAIN_COLORS[terrain]))
  );

  const interactionRef = useRef<InteractionState>({
    mode: 'none',
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startViewX: 0,
    startViewY: 0,
    lastTileX: -1,
    lastTileY: -1,
  });

  const activeOperationRef = useRef<MutableOperation | null>(null);
  const replaceTargetRef = useRef<number | null>(null);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const rectCurrentRef = useRef<{ x: number; y: number } | null>(null);

  const undoStackRef = useRef<StoredOperation[]>([]);
  const redoStackRef = useRef<StoredOperation[]>([]);
  const isSpacePressedRef = useRef(false);
  const previewSyncRef = useRef<number>(0);
  const previewFollowTimeoutRef = useRef<number | null>(null);
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const zoomTargetRef = useRef<number | null>(null);

  const selectedTerrain = indexToTerrain(selectedTerrainIndex);

  const selectedSnapshot = useMemo(
    () => snapshots.find((item) => item.id === selectedSnapshotId) ?? null,
    [snapshots, selectedSnapshotId]
  );

  const getProjectionForState = useCallback((state: ViewState): CanvasProjection => {
    const canvasWidth = Math.max(1, canvasSize.width);
    const canvasHeight = Math.max(1, canvasSize.height);
    const zoom = Math.max(state.zoom, 0.0001);

    const viewWorldWidth = canvasWidth / zoom;
    const viewWorldHeight = canvasHeight / zoom;
    const fitsWorldHorizontally = viewWorldWidth >= WORLD_SIZE;
    const fitsWorldVertically = viewWorldHeight >= WORLD_SIZE;

    const srcWidth = fitsWorldHorizontally ? WORLD_SIZE : viewWorldWidth;
    const srcHeight = fitsWorldVertically ? WORLD_SIZE : viewWorldHeight;
    const srcX = fitsWorldHorizontally ? 0 : clamp(state.x, 0, WORLD_SIZE - srcWidth);
    const srcY = fitsWorldVertically ? 0 : clamp(state.y, 0, WORLD_SIZE - srcHeight);

    const destWidth = srcWidth * zoom;
    const destHeight = srcHeight * zoom;
    const destX = fitsWorldHorizontally ? (canvasWidth - destWidth) * 0.5 : 0;
    const destY = fitsWorldVertically ? (canvasHeight - destHeight) * 0.5 : 0;

    return {
      canvasWidth,
      canvasHeight,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      destX,
      destY,
      destWidth,
      destHeight,
      zoom,
    };
  }, [canvasSize.height, canvasSize.width]);

  const mapCenter = useMemo(() => {
    const projection = getProjectionForState(viewState);
    if (projection.srcWidth <= 0 || projection.srcHeight <= 0) {
      return {
        x: Math.floor(WORLD_SIZE / 2),
        y: Math.floor(WORLD_SIZE / 2),
      };
    }

    return {
      x: clamp(Math.round(projection.srcX + projection.srcWidth * 0.5), 0, WORLD_SIZE - 1),
      y: clamp(Math.round(projection.srcY + projection.srcHeight * 0.5), 0, WORLD_SIZE - 1),
    };
  }, [getProjectionForState, viewState]);

  const getZoomBounds = useCallback(() => {
    const width = Math.max(1, canvasSize.width);
    const height = Math.max(1, canvasSize.height);
    const fitZoomX = width / WORLD_SIZE;
    const fitZoomY = height / WORLD_SIZE;
    const minZoom = Math.max(MIN_ZOOM_FLOOR, Math.min(fitZoomX, fitZoomY));
    return { minZoom, maxZoom: MAX_ZOOM };
  }, [canvasSize.height, canvasSize.width]);

  const activePreviewCenter = useMemo(
    () => (followPreviewCenter ? followedPreviewCenter : manualPreviewCenter),
    [followPreviewCenter, followedPreviewCenter, manualPreviewCenter]
  );

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }, []);

  const requestPreviewSync = useCallback((force = false) => {
    const now = performance.now();
    if (force || now - previewSyncRef.current >= 120) {
      previewSyncRef.current = now;
      setPreviewVersion((value) => value + 1);
    }
  }, []);

  const ensureOffscreenCanvas = useCallback(() => {
    if (offscreenCanvasRef.current && offscreenCtxRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = WORLD_SIZE;
    canvas.height = WORLD_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    offscreenCanvasRef.current = canvas;
    offscreenCtxRef.current = ctx;
  }, []);

  const recalculateCounts = useCallback(() => {
    countsRef.current = computeTerrainCounts(worldRef.current);
    setTerrainCounts([...countsRef.current]);
  }, []);

  const redrawOffscreenWorld = useCallback(() => {
    ensureOffscreenCanvas();
    const offscreen = offscreenCanvasRef.current;
    const ctx = offscreenCtxRef.current;
    if (!offscreen || !ctx) return;

    const image = ctx.createImageData(WORLD_SIZE, WORLD_SIZE);
    const data = image.data;
    const world = worldRef.current;
    const palette = rgbPaletteRef.current;

    for (let i = 0; i < world.length; i++) {
      const [r, g, b] = palette[world[i]];
      const base = i * 4;
      data[base] = r;
      data[base + 1] = g;
      data[base + 2] = b;
      data[base + 3] = 255;
    }

    ctx.putImageData(image, 0, 0);
  }, [ensureOffscreenCanvas]);

  const paintOffscreenPixel = useCallback((x: number, y: number, terrainIndex: number) => {
    const ctx = offscreenCtxRef.current;
    if (!ctx) return;
    const terrain = indexToTerrain(terrainIndex);
    ctx.fillStyle = TERRAIN_COLORS[terrain];
    ctx.fillRect(x, y, 1, 1);
  }, []);

  const clampViewState = useCallback(
    (next: ViewState): ViewState => {
      const width = Math.max(1, canvasSize.width);
      const height = Math.max(1, canvasSize.height);
      const bounds = getZoomBounds();
      const zoom = clamp(next.zoom, bounds.minZoom, bounds.maxZoom);
      const viewWorldWidth = width / zoom;
      const viewWorldHeight = height / zoom;

      const maxX = WORLD_SIZE - viewWorldWidth;
      const maxY = WORLD_SIZE - viewWorldHeight;

      const x = maxX <= 0 ? 0 : clamp(next.x, 0, maxX);
      const y = maxY <= 0 ? 0 : clamp(next.y, 0, maxY);
      return { x, y, zoom };
    },
    [canvasSize.height, canvasSize.width, getZoomBounds]
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!canvas || !offscreen) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = viewStateRef.current;
    const projection = getProjectionForState(state);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    if (projection.srcWidth > 0 && projection.srcHeight > 0 && projection.destWidth > 0 && projection.destHeight > 0) {
      ctx.drawImage(
        offscreen,
        projection.srcX,
        projection.srcY,
        projection.srcWidth,
        projection.srcHeight,
        projection.destX,
        projection.destY,
        projection.destWidth,
        projection.destHeight
      );
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      projection.destX + 0.5,
      projection.destY + 0.5,
      Math.max(0, projection.destWidth - 1),
      Math.max(0, projection.destHeight - 1)
    );
    ctx.restore();

    const worldToScreenX = (worldX: number): number =>
      projection.destX + ((worldX - projection.srcX) / Math.max(projection.srcWidth, 0.0001)) * projection.destWidth;
    const worldToScreenY = (worldY: number): number =>
      projection.destY + ((worldY - projection.srcY) / Math.max(projection.srcHeight, 0.0001)) * projection.destHeight;

    if (showGrid && state.zoom >= 2.4 && projection.srcWidth > 0 && projection.srcHeight > 0) {
      const startX = Math.floor(projection.srcX);
      const endX = Math.ceil(projection.srcX + projection.srcWidth);
      const startY = Math.floor(projection.srcY);
      const endY = Math.ceil(projection.srcY + projection.srcHeight);

      ctx.save();
      ctx.beginPath();
      ctx.rect(projection.destX, projection.destY, projection.destWidth, projection.destHeight);
      ctx.clip();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let x = startX; x <= endX; x++) {
        const screenX = worldToScreenX(x);
        ctx.moveTo(screenX, projection.destY);
        ctx.lineTo(screenX, projection.destY + projection.destHeight);
      }
      for (let y = startY; y <= endY; y++) {
        const screenY = worldToScreenY(y);
        ctx.moveTo(projection.destX, screenY);
        ctx.lineTo(projection.destX + projection.destWidth, screenY);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (interactionRef.current.mode === 'rectangle' && rectStartRef.current && rectCurrentRef.current) {
      const a = rectStartRef.current;
      const b = rectCurrentRef.current;
      const x0 = Math.min(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const x1 = Math.max(a.x, b.x);
      const y1 = Math.max(a.y, b.y);
      const sx = worldToScreenX(x0);
      const sy = worldToScreenY(y0);
      const sw = worldToScreenX(x1 + 1) - sx;
      const sh = worldToScreenY(y1 + 1) - sy;

      ctx.save();
      ctx.beginPath();
      ctx.rect(projection.destX, projection.destY, projection.destWidth, projection.destHeight);
      ctx.clip();
      ctx.fillStyle = 'rgba(249, 115, 22, 0.18)';
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.restore();
    }

    const previewMinX = activePreviewCenter.x - PREVIEW_RADIUS;
    const previewMinY = activePreviewCenter.y - PREVIEW_RADIUS;
    const previewSize = PREVIEW_RADIUS * 2 + 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(projection.destX, projection.destY, projection.destWidth, projection.destHeight);
    ctx.clip();
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const previewScreenX = worldToScreenX(previewMinX);
    const previewScreenY = worldToScreenY(previewMinY);
    const previewScreenW = worldToScreenX(previewMinX + previewSize) - previewScreenX;
    const previewScreenH = worldToScreenY(previewMinY + previewSize) - previewScreenY;
    ctx.strokeRect(
      previewScreenX,
      previewScreenY,
      previewScreenW,
      previewScreenH
    );
    ctx.restore();
  }, [activePreviewCenter.x, activePreviewCenter.y, getProjectionForState, showGrid]);

  const getTileFromPointer = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(rect.width, 1);
      const scaleY = canvas.height / Math.max(rect.height, 1);
      const px = (clientX - rect.left) * scaleX;
      const py = (clientY - rect.top) * scaleY;
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;

      const state = viewStateRef.current;
      const projection = getProjectionForState(state);
      if (
        px < projection.destX ||
        py < projection.destY ||
        px > projection.destX + projection.destWidth ||
        py > projection.destY + projection.destHeight
      ) {
        return null;
      }
      const worldX = projection.srcX + ((px - projection.destX) / Math.max(projection.destWidth, 0.0001)) * projection.srcWidth;
      const worldY = projection.srcY + ((py - projection.destY) / Math.max(projection.destHeight, 0.0001)) * projection.srcHeight;
      const x = Math.floor(worldX);
      const y = Math.floor(worldY);
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return null;
      return { x, y };
    },
    [getProjectionForState]
  );

  const beginOperation = useCallback((label: string) => {
    activeOperationRef.current = {
      label,
      previous: new Map(),
      next: new Map(),
    };
  }, []);

  const commitOperation = useCallback(() => {
    const op = activeOperationRef.current;
    activeOperationRef.current = null;
    replaceTargetRef.current = null;
    if (!op || op.next.size === 0) return false;

    const indices = Array.from(op.next.keys());
    const stored: StoredOperation = {
      label: op.label,
      indices,
      previous: indices.map((index) => op.previous.get(index) ?? 0),
      next: indices.map((index) => op.next.get(index) ?? 0),
    };

    undoStackRef.current.push(stored);
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.splice(0, undoStackRef.current.length - MAX_HISTORY);
    }
    redoStackRef.current = [];
    syncHistoryState();
    setTerrainCounts([...countsRef.current]);
    requestPreviewSync(true);
    return true;
  }, [requestPreviewSync, syncHistoryState]);

  const writeTerrainAt = useCallback(
    (
      x: number,
      y: number,
      nextTerrainIndex: number,
      operation: MutableOperation,
      replaceTarget: number | null
    ) => {
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
      const index = tileIndex(x, y);
      const world = worldRef.current;
      const current = world[index];
      if (replaceTarget !== null && current !== replaceTarget) return false;
      if (current === nextTerrainIndex) return false;

      if (!operation.previous.has(index)) {
        operation.previous.set(index, current);
      }
      operation.next.set(index, nextTerrainIndex);

      world[index] = nextTerrainIndex;
      countsRef.current[current] -= 1;
      countsRef.current[nextTerrainIndex] += 1;
      paintOffscreenPixel(x, y, nextTerrainIndex);
      return true;
    },
    [paintOffscreenPixel]
  );

  const applyBrushAt = useCallback(
    (
      x: number,
      y: number,
      terrainIndex: number,
      operation: MutableOperation,
      replaceTarget: number | null
    ) => {
      const radius = Math.floor((brushSize - 1) / 2);
      const symmetryPoints = getSymmetryPoints(x, y, symmetry);

      for (const point of symmetryPoints) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > radius + 0.15) continue;
            writeTerrainAt(point.x + dx, point.y + dy, terrainIndex, operation, replaceTarget);
          }
        }
      }
    },
    [brushSize, symmetry, writeTerrainAt]
  );

  const applyBrushLine = useCallback(
    (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      terrainIndex: number,
      operation: MutableOperation,
      replaceTarget: number | null
    ) => {
      let cx = x0;
      let cy = y0;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        applyBrushAt(cx, cy, terrainIndex, operation, replaceTarget);
        if (cx === x1 && cy === y1) break;
        const e2 = err * 2;
        if (e2 > -dy) {
          err -= dy;
          cx += sx;
        }
        if (e2 < dx) {
          err += dx;
          cy += sy;
        }
      }
    },
    [applyBrushAt]
  );

  const fillRectangle = useCallback(
    (
      start: { x: number; y: number },
      end: { x: number; y: number },
      terrainIndex: number,
      operation: MutableOperation
    ) => {
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const symmetryPoints = getSymmetryPoints(x, y, symmetry);
          for (const point of symmetryPoints) {
            writeTerrainAt(point.x, point.y, terrainIndex, operation, null);
          }
        }
      }
    },
    [symmetry, writeTerrainAt]
  );

  const floodFill = useCallback(
    (startX: number, startY: number, nextTerrainIndex: number, operation: MutableOperation) => {
      const startPoints = getSymmetryPoints(startX, startY, symmetry);

      for (const startPoint of startPoints) {
        const startIndex = tileIndex(startPoint.x, startPoint.y);
        const targetTerrain = worldRef.current[startIndex];
        if (targetTerrain === nextTerrainIndex) continue;

        const visited = new Uint8Array(WORLD_TILE_COUNT);
        const queue: number[] = [startIndex];
        let pointer = 0;

        while (pointer < queue.length) {
          const index = queue[pointer++];
          if (visited[index]) continue;
          visited[index] = 1;

          const current = worldRef.current[index];
          if (current !== targetTerrain) continue;

          const x = index % WORLD_SIZE;
          const y = Math.floor(index / WORLD_SIZE);
          writeTerrainAt(x, y, nextTerrainIndex, operation, targetTerrain);

          if (x > 0) queue.push(index - 1);
          if (x < WORLD_SIZE - 1) queue.push(index + 1);
          if (y > 0) queue.push(index - WORLD_SIZE);
          if (y < WORLD_SIZE - 1) queue.push(index + WORLD_SIZE);
        }
      }
    },
    [symmetry, writeTerrainAt]
  );

  const setWorldWithSeed = useCallback(
    (nextSeed: number) => {
      worldRef.current = generateSeededWorld(nextSeed);
      setSeed(nextSeed);
      recalculateCounts();
      redrawOffscreenWorld();
      requestPreviewSync(true);
      undoStackRef.current = [];
      redoStackRef.current = [];
      syncHistoryState();
      setStatusMessage(`This world is randomly generated from seed ${nextSeed}. You can build on top of it.`);
      setErrorMessage(null);
      drawCanvas();
    },
    [drawCanvas, recalculateCounts, redrawOffscreenWorld, requestPreviewSync, syncHistoryState]
  );

  const applyStoredOperation = useCallback((operation: StoredOperation, direction: 'undo' | 'redo') => {
    const world = worldRef.current;
    const values = direction === 'undo' ? operation.previous : operation.next;
    for (let i = 0; i < operation.indices.length; i++) {
      const index = operation.indices[i];
      world[index] = values[i];
      const x = index % WORLD_SIZE;
      const y = Math.floor(index / WORLD_SIZE);
      paintOffscreenPixel(x, y, values[i]);
    }
    recalculateCounts();
    requestPreviewSync(true);
    drawCanvas();
  }, [drawCanvas, paintOffscreenPixel, recalculateCounts, requestPreviewSync]);

  const undo = useCallback(() => {
    const operation = undoStackRef.current.pop();
    if (!operation) return;
    redoStackRef.current.push(operation);
    applyStoredOperation(operation, 'undo');
    syncHistoryState();
    setStatusMessage(`Undo: ${operation.label}`);
  }, [applyStoredOperation, syncHistoryState]);

  const redo = useCallback(() => {
    const operation = redoStackRef.current.pop();
    if (!operation) return;
    undoStackRef.current.push(operation);
    applyStoredOperation(operation, 'redo');
    syncHistoryState();
    setStatusMessage(`Redo: ${operation.label}`);
  }, [applyStoredOperation, syncHistoryState]);

  const loadSnapshot = useCallback((snapshot: WorldDesignerSnapshot) => {
    const parsed = deserializeWorldFromBase64(snapshot.worldBase64);
    if (!parsed) {
      setErrorMessage(`Failed to decode snapshot "${snapshot.name}".`);
      return;
    }

    worldRef.current = parsed;
    setSeed(snapshot.seed);
    recalculateCounts();
    redrawOffscreenWorld();
    requestPreviewSync(true);
    setStatusMessage(`Loaded snapshot "${snapshot.name}".`);
    setErrorMessage(null);
    drawCanvas();
  }, [drawCanvas, recalculateCounts, redrawOffscreenWorld, requestPreviewSync]);

  const saveSnapshot = useCallback(() => {
    const name = snapshotName.trim() || `Snapshot ${new Date().toLocaleString()}`;
    const snapshot: WorldDesignerSnapshot = {
      id: `wds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: nowIso(),
      seed,
      worldBase64: serializeWorldToBase64(worldRef.current),
    };

    setSnapshots((previous) => [snapshot, ...previous].slice(0, MAX_SNAPSHOTS));
    setSelectedSnapshotId(snapshot.id);
    setSnapshotName('');
    setStatusMessage(`Saved snapshot "${name}".`);
    setErrorMessage(null);
  }, [seed, snapshotName]);

  const deleteSelectedSnapshot = useCallback(() => {
    if (!selectedSnapshot) return;
    const deletingId = selectedSnapshot.id;
    setSnapshots((previous) => previous.filter((snapshot) => snapshot.id !== deletingId));
    setSelectedSnapshotId((previous) => {
      if (previous !== deletingId) return previous;
      const remaining = snapshots.filter((snapshot) => snapshot.id !== deletingId);
      return remaining[0]?.id ?? null;
    });
    setStatusMessage(`Deleted snapshot "${selectedSnapshot.name}".`);
  }, [selectedSnapshot, snapshots]);

  const exportSelectedSnapshot = useCallback(() => {
    if (!selectedSnapshot) {
      setErrorMessage('Select a snapshot first.');
      return;
    }
    setExportJson(JSON.stringify(selectedSnapshot, null, 2));
    setStatusMessage(`Prepared JSON export for "${selectedSnapshot.name}".`);
    setErrorMessage(null);
  }, [selectedSnapshot]);

  const importSnapshots = useCallback(() => {
    if (!importJson.trim()) {
      setErrorMessage('Paste snapshot JSON before importing.');
      return;
    }

    try {
      const input = JSON.parse(importJson) as unknown;
      const incoming = parseSnapshots(Array.isArray(input) ? input : [input]);
      if (incoming.length === 0) {
        setErrorMessage('No valid snapshots found in JSON payload.');
        return;
      }

      const validIncoming = incoming.filter((snapshot) =>
        deserializeWorldFromBase64(snapshot.worldBase64) !== null
      );
      if (validIncoming.length === 0) {
        setErrorMessage('Snapshots could not be decoded (invalid payload).');
        return;
      }

      setSnapshots((previous) => {
        const byId = new Map<string, WorldDesignerSnapshot>();
        for (const snapshot of validIncoming) byId.set(snapshot.id, snapshot);
        for (const snapshot of previous) if (!byId.has(snapshot.id)) byId.set(snapshot.id, snapshot);
        return Array.from(byId.values())
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_SNAPSHOTS);
      });

      setSelectedSnapshotId(validIncoming[0].id);
      setStatusMessage(`Imported ${validIncoming.length} snapshot(s).`);
      setErrorMessage(null);
    } catch {
      setErrorMessage('Invalid JSON payload.');
    }
  }, [importJson]);

  const resetWorldToTerrain = useCallback((terrain: TerrainType) => {
    const nextTerrain = terrainToIndex(terrain);
    const world = new Uint8Array(WORLD_TILE_COUNT);
    world.fill(nextTerrain);
    worldRef.current = world;
    recalculateCounts();
    redrawOffscreenWorld();
    requestPreviewSync(true);
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryState();
    drawCanvas();
    setStatusMessage(`Filled world with ${terrain}.`);
    setErrorMessage(null);
  }, [drawCanvas, recalculateCounts, redrawOffscreenWorld, requestPreviewSync, syncHistoryState]);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/auth');
      const data = await response.json();
      setIsAuthenticated(Boolean(data.authenticated));
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = parseSnapshots(JSON.parse(raw) as unknown);
      setSnapshots(parsed);
      if (parsed.length > 0) setSelectedSnapshotId(parsed[0].id);
    } catch {
      setSnapshots([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  }, [snapshots]);

  useEffect(() => {
    ensureOffscreenCanvas();
    redrawOffscreenWorld();
  }, [ensureOffscreenCanvas, redrawOffscreenWorld]);

  useEffect(() => {
    viewStateRef.current = viewState;
    drawCanvas();
  }, [viewState, drawCanvas]);

  useEffect(() => {
    const wrapper = viewportRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const resize = () => {
      const width = Math.max(320, Math.floor(wrapper.clientWidth));
      const height = Math.max(420, Math.floor(wrapper.clientHeight));
      canvas.width = width;
      canvas.height = height;
      setCanvasSize({ width, height });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    resize();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setViewState((current) => {
      if (!hasInitializedViewRef.current) {
        hasInitializedViewRef.current = true;
        return clampViewState({ x: 0, y: 0, zoom: 0 });
      }
      return clampViewState(current);
    });
  }, [canvasSize.height, canvasSize.width, clampViewState]);

  useEffect(() => {
    if (!followPreviewCenter) return;
    const nextCenterX = mapCenter.x;
    const nextCenterY = mapCenter.y;
    if (followedPreviewCenter.x === nextCenterX && followedPreviewCenter.y === nextCenterY) return;

    if (previewFollowTimeoutRef.current !== null) {
      window.clearTimeout(previewFollowTimeoutRef.current);
    }
    previewFollowTimeoutRef.current = window.setTimeout(() => {
      setFollowedPreviewCenter({ x: nextCenterX, y: nextCenterY });
      previewFollowTimeoutRef.current = null;
    }, PREVIEW_FOLLOW_SYNC_MS);

    return () => {
      if (previewFollowTimeoutRef.current !== null) {
        window.clearTimeout(previewFollowTimeoutRef.current);
        previewFollowTimeoutRef.current = null;
      }
    };
  }, [
    followPreviewCenter,
    followedPreviewCenter.x,
    followedPreviewCenter.y,
    mapCenter.x,
    mapCenter.y,
  ]);

  useEffect(() => {
    return () => {
      if (previewFollowTimeoutRef.current !== null) {
        window.clearTimeout(previewFollowTimeoutRef.current);
      }
      if (zoomAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isTextInput = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
      if (isTextInput) return;

      if (event.key === ' ') {
        isSpacePressedRef.current = true;
      }

      const lower = event.key.toLowerCase();
      const shortcutIndex = TERRAIN_SHORTCUTS.indexOf(lower as (typeof TERRAIN_SHORTCUTS)[number]);
      if (shortcutIndex >= 0 && shortcutIndex < WORLD_DESIGNER_TERRAINS.length) {
        setSelectedTerrainIndex(shortcutIndex);
      }

      if (event.metaKey || event.ctrlKey) {
        if (lower === 'z' && !event.shiftKey) {
          event.preventDefault();
          undo();
        } else if ((lower === 'z' && event.shiftKey) || lower === 'y') {
          event.preventDefault();
          redo();
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [redo, undo]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (!data.success) {
        setLoginError(data.error || 'Login failed');
        return;
      }

      setPassword('');
      setIsAuthenticated(true);
    } catch {
      setLoginError('Connection error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
    } finally {
      setIsAuthenticated(false);
    }
  };

  const applyZoomAtCanvasCenter = useCallback((nextZoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const px = canvas.width * 0.5;
    const py = canvas.height * 0.5;
    const current = viewStateRef.current;
    const projection = getProjectionForState(current);
    const centerInsideWorld =
      px >= projection.destX &&
      px <= projection.destX + projection.destWidth &&
      py >= projection.destY &&
      py <= projection.destY + projection.destHeight;
    const worldX = centerInsideWorld
      ? projection.srcX + ((px - projection.destX) / Math.max(projection.destWidth, 0.0001)) * projection.srcWidth
      : mapCenter.x + 0.5;
    const worldY = centerInsideWorld
      ? projection.srcY + ((py - projection.destY) / Math.max(projection.destHeight, 0.0001)) * projection.srcHeight
      : mapCenter.y + 0.5;
    const nextState = clampViewState({
      x: worldX - (canvas.width * 0.5) / nextZoom,
      y: worldY - (canvas.height * 0.5) / nextZoom,
      zoom: nextZoom,
    });

    viewStateRef.current = nextState;
    setViewState(nextState);
    drawCanvas();
  }, [clampViewState, drawCanvas, getProjectionForState, mapCenter.x, mapCenter.y]);

  const animateZoomTo = useCallback((nextTargetZoom: number) => {
    const bounds = getZoomBounds();
    zoomTargetRef.current = clamp(nextTargetZoom, bounds.minZoom, bounds.maxZoom);

    if (zoomAnimationFrameRef.current !== null) return;

    const tick = () => {
      const target = zoomTargetRef.current;
      if (target === null) {
        zoomAnimationFrameRef.current = null;
        return;
      }

      const currentZoom = viewStateRef.current.zoom;
      const delta = target - currentZoom;

      if (Math.abs(delta) <= ZOOM_SETTLE_EPSILON) {
        applyZoomAtCanvasCenter(target);
        zoomAnimationFrameRef.current = null;
        if (zoomTargetRef.current === target) {
          zoomTargetRef.current = null;
        }
        return;
      }

      const nextZoom = currentZoom + delta * 0.28;
      applyZoomAtCanvasCenter(nextZoom);
      zoomAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    zoomAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [applyZoomAtCanvasCenter, getZoomBounds]);

  const applyZoom = useCallback((direction: 'in' | 'out') => {
    const bounds = getZoomBounds();
    const baseZoom = zoomTargetRef.current ?? viewStateRef.current.zoom;
    const nextZoom = direction === 'in'
      ? baseZoom * ZOOM_STEP_FACTOR
      : baseZoom / ZOOM_STEP_FACTOR;
    const clampedZoom = clamp(nextZoom, bounds.minZoom, bounds.maxZoom);
    animateZoomTo(clampedZoom);
  }, [animateZoomTo, getZoomBounds]);

  const fitZoom = useCallback(() => {
    const bounds = getZoomBounds();
    animateZoomTo(bounds.minZoom);
  }, [animateZoomTo, getZoomBounds]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPreviewPickMode) {
      const tile = getTileFromPointer(event.clientX, event.clientY);
      if (tile) {
        setFollowPreviewCenter(false);
        setManualPreviewCenter(tile);
        setIsPreviewPickMode(false);
        setStatusMessage(`3D source center set to (${tile.x}, ${tile.y}).`);
        setErrorMessage(null);
      }
      return;
    }

    const shouldPan = event.button === 1 || event.button === 2 || isSpacePressedRef.current;
    const interaction = interactionRef.current;
    interaction.pointerId = event.pointerId;
    interaction.startClientX = event.clientX;
    interaction.startClientY = event.clientY;
    interaction.startViewX = viewStateRef.current.x;
    interaction.startViewY = viewStateRef.current.y;
    interaction.lastTileX = -1;
    interaction.lastTileY = -1;

    const canvas = canvasRef.current;

    if (shouldPan) {
      if (canvas) canvas.setPointerCapture(event.pointerId);
      interaction.mode = 'pan';
      return;
    }

    const tile = getTileFromPointer(event.clientX, event.clientY);
    if (!tile) {
      interaction.pointerId = null;
      return;
    }

    if (canvas) canvas.setPointerCapture(event.pointerId);

    interaction.lastTileX = tile.x;
    interaction.lastTileY = tile.y;

    if (tool === 'eyedropper') {
      const terrainIndex = worldRef.current[tileIndex(tile.x, tile.y)];
      setSelectedTerrainIndex(terrainIndex);
      setStatusMessage(`Picked terrain: ${indexToTerrain(terrainIndex)}.`);
      setErrorMessage(null);
      return;
    }

    if (tool === 'bucket') {
      beginOperation('Bucket fill');
      const operation = activeOperationRef.current;
      if (!operation) return;
      floodFill(tile.x, tile.y, selectedTerrainIndex, operation);
      commitOperation();
      drawCanvas();
      return;
    }

    if (tool === 'rectangle') {
      interaction.mode = 'rectangle';
      rectStartRef.current = tile;
      rectCurrentRef.current = tile;
      drawCanvas();
      return;
    }

    beginOperation(tool === 'replace' ? 'Replace stroke' : 'Brush stroke');
    const operation = activeOperationRef.current;
    if (!operation) return;
    replaceTargetRef.current = tool === 'replace' ? worldRef.current[tileIndex(tile.x, tile.y)] : null;
    applyBrushAt(tile.x, tile.y, selectedTerrainIndex, operation, replaceTargetRef.current);
    interaction.mode = 'paint';
    drawCanvas();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (interaction.mode === 'none') return;

    if (interaction.mode === 'pan') {
      const dx = event.clientX - interaction.startClientX;
      const dy = event.clientY - interaction.startClientY;
      const current = viewStateRef.current;
      const next = clampViewState({
        x: interaction.startViewX - dx / current.zoom,
        y: interaction.startViewY - dy / current.zoom,
        zoom: current.zoom,
      });
      viewStateRef.current = next;
      setViewState(next);
      drawCanvas();
      return;
    }

    const tile = getTileFromPointer(event.clientX, event.clientY);
    if (!tile) return;

    if (interaction.mode === 'rectangle') {
      rectCurrentRef.current = tile;
      drawCanvas();
      return;
    }

    if (interaction.mode === 'paint') {
      if (tile.x === interaction.lastTileX && tile.y === interaction.lastTileY) return;
      const operation = activeOperationRef.current;
      if (!operation) return;

      applyBrushLine(
        interaction.lastTileX,
        interaction.lastTileY,
        tile.x,
        tile.y,
        selectedTerrainIndex,
        operation,
        replaceTargetRef.current
      );

      interaction.lastTileX = tile.x;
      interaction.lastTileY = tile.y;
      requestPreviewSync(false);
      drawCanvas();
    }
  };

  const finishInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    if (interaction.mode === 'paint') {
      if (commitOperation()) {
        setStatusMessage('Applied paint operation.');
        setErrorMessage(null);
      }
    } else if (interaction.mode === 'rectangle') {
      const start = rectStartRef.current;
      const end = rectCurrentRef.current;
      if (start && end) {
        beginOperation('Rectangle fill');
        const operation = activeOperationRef.current;
        if (operation) {
          fillRectangle(start, end, selectedTerrainIndex, operation);
          if (commitOperation()) {
            setStatusMessage('Applied rectangle fill.');
            setErrorMessage(null);
          }
        }
      }
      rectStartRef.current = null;
      rectCurrentRef.current = null;
    }

    interaction.mode = 'none';
    interaction.pointerId = null;
    replaceTargetRef.current = null;
    drawCanvas();
  }, [beginOperation, commitOperation, drawCanvas, fillRectangle, selectedTerrainIndex]);

  const handlePointerUp = () => {
    finishInteraction();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  };

  const previewTiles = useMemo(
    () => {
      void previewVersion;
      return extractTileWindow(worldRef.current, activePreviewCenter.x, activePreviewCenter.y, PREVIEW_RADIUS);
    },
    [activePreviewCenter.x, activePreviewCenter.y, previewVersion]
  );

  const zoomBounds = useMemo(() => getZoomBounds(), [getZoomBounds]);
  const canZoomOut = viewState.zoom > zoomBounds.minZoom + 0.001;
  const canZoomIn = viewState.zoom < zoomBounds.maxZoom - 0.001;
  const zoomPercent = Math.round((viewState.zoom / Math.max(zoomBounds.minZoom, 0.0001)) * 100);

  if (isAuthenticated === null) {
    return (
      <main className="min-h-screen bg-slate-100 p-8 text-slate-700">
        Loading world designer...
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="mb-6 text-center">
            <span className="text-5xl">🗺️</span>
            <h1 className="mt-3 text-2xl font-bold text-slate-800">World Designer</h1>
            <p className="mt-1 text-sm text-slate-500">Admin access required</p>
          </div>

          <form onSubmit={handleLogin}>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-600">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-orange-500 focus:outline-none"
              placeholder="Enter admin password"
              autoFocus
            />

            {loginError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn || !password}
              className="w-full rounded-lg bg-orange-500 py-2 font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingIn ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-slate-500 transition hover:text-orange-600">
              ← Back to ClawCity
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1980px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">🗺️ World Designer</h1>
            <p className="text-sm text-slate-600">
              This world is randomly generated from seed <span className="font-semibold text-slate-800">{seed}</span>. You can build on top of it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={adminPath}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-orange-400 hover:text-orange-700"
            >
              ← Admin
            </Link>
            <Link
              href={`${adminPath}/analytics`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-orange-400 hover:text-orange-700"
            >
              📊 Analytics
            </Link>
            <Link
              href={`${adminPath}/railway`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-orange-400 hover:text-orange-700"
            >
              🚂 Railway
            </Link>
            <Link
              href={`${adminPath}/render-lab`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-orange-400 hover:text-orange-700"
            >
              🧪 Render Lab
            </Link>
            <Link
              href={`${adminPath}/avatar-lab`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-orange-400 hover:text-orange-700"
            >
              🦀 Avatar Lab
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
            >
              Logout
            </button>
          </div>
        </header>

        {statusMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_430px]">
          <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tools</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setTool(option.id)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      tool === option.id
                        ? 'border-orange-400 bg-orange-50 text-orange-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-orange-300'
                    }`}
                  >
                    <div className="font-medium">{option.label}</div>
                    <div className="text-xs text-slate-500">{option.help}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="border-t border-slate-200 pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Terrain Palette</h2>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {WORLD_DESIGNER_TERRAINS.map((terrain, index) => (
                  <button
                    key={terrain}
                    onClick={() => setSelectedTerrainIndex(index)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                      selectedTerrainIndex === index
                        ? 'border-orange-400 bg-orange-50 text-orange-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-orange-300'
                    }`}
                  >
                    <div className="mb-1 h-4 w-full rounded" style={{ background: TERRAIN_COLORS[terrain] }} />
                    {index + 1}. {terrain}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Quick keys: {WORLD_DESIGNER_TERRAINS.map((terrain, i) => `${i + 1}:${terrain}`).join(' • ')}
              </div>
            </section>

            <section className="border-t border-slate-200 pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Brush & Symmetry</h2>
              <label className="mt-2 block text-sm text-slate-600">
                Brush size
                <select
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value) as (typeof BRUSH_SIZES)[number])}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {BRUSH_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}x{size}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-sm text-slate-600">
                Symmetry mode
                <select
                  value={symmetry}
                  onChange={(event) => setSymmetry(event.target.value as WorldDesignerSymmetryMode)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="off">Off</option>
                  <option value="mirror_x">Mirror X (left/right)</option>
                  <option value="mirror_y">Mirror Y (top/bottom)</option>
                  <option value="quad">Quad mirror</option>
                </select>
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
                Show grid overlay
              </label>
            </section>

            <section className="border-t border-slate-200 pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={undo}
                  disabled={historyState.undo === 0}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-orange-300 disabled:opacity-40"
                >
                  Undo ({historyState.undo})
                </button>
                <button
                  onClick={redo}
                  disabled={historyState.redo === 0}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-orange-300 disabled:opacity-40"
                >
                  Redo ({historyState.redo})
                </button>
              </div>
            </section>

            <section className="border-t border-slate-200 pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">World Actions</h2>
              <div className="mt-2 space-y-2">
                <button
                  onClick={() => setWorldWithSeed(randomSeed())}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-orange-300"
                >
                  Regenerate seeded random world
                </button>
                <button
                  onClick={() => resetWorldToTerrain(selectedTerrain)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-orange-300"
                >
                  Fill world with selected terrain ({selectedTerrain})
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Navigation: zoom with -, Fit, + buttons, pan with right-click/middle-click or hold space.
              </p>
              {isPreviewPickMode && (
                <p className="mt-1 text-xs font-medium text-orange-700">
                  Preview source pick mode active: click a tile on the map to set 3D source center.
                </p>
              )}
            </section>
          </aside>

          <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-600">
                  Active tool: <span className="font-semibold text-slate-800">{tool}</span> • Terrain:{' '}
                  <span className="font-semibold text-slate-800">{selectedTerrain}</span> • Symmetry:{' '}
                  <span className="font-semibold text-slate-800">{symmetry}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button
                    onClick={() => applyZoom('out')}
                    disabled={!canZoomOut}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Zoom out"
                  >
                    −
                  </button>
                  <button
                    onClick={fitZoom}
                    disabled={!canZoomOut}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Fit full map"
                  >
                    Fit
                  </button>
                  <button
                    onClick={() => applyZoom('in')}
                    disabled={!canZoomIn}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Zoom in"
                  >
                    +
                  </button>
                  <span>
                    Map center: ({mapCenter.x}, {mapCenter.y}) • 3D source: ({activePreviewCenter.x}, {activePreviewCenter.y}) • Zoom{' '}
                    {viewState.zoom.toFixed(2)}x ({zoomPercent}%)
                  </span>
                </div>
              </div>
              <div ref={viewportRef} className="relative h-[700px] w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
                <canvas
                  ref={canvasRef}
                  className="h-full w-full touch-none cursor-crosshair"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onContextMenu={handleContextMenu}
                />
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">3D Source Reference</h2>
              <p className="mt-2 text-xs text-slate-600">
                3D preview uses the cyan dashed box from the main map. You can keep it synced to the map center or set it manually.
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={followPreviewCenter}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setFollowPreviewCenter(checked);
                    if (checked) {
                      setIsPreviewPickMode(false);
                    }
                    if (checked) {
                      if (previewFollowTimeoutRef.current !== null) {
                        window.clearTimeout(previewFollowTimeoutRef.current);
                        previewFollowTimeoutRef.current = null;
                      }
                      setFollowedPreviewCenter(mapCenter);
                    }
                  }}
                />
                Follow map center
              </label>
              {!followPreviewCenter && (
                <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-600">
                      Source X
                      <input
                        type="number"
                        min={0}
                        max={WORLD_SIZE - 1}
                        value={manualPreviewCenter.x}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value, 10);
                          if (Number.isNaN(parsed)) return;
                          setManualPreviewCenter((current) => ({
                            ...current,
                            x: clamp(parsed, 0, WORLD_SIZE - 1),
                          }));
                        }}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
                      />
                    </label>
                    <label className="text-xs text-slate-600">
                      Source Y
                      <input
                        type="number"
                        min={0}
                        max={WORLD_SIZE - 1}
                        value={manualPreviewCenter.y}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value, 10);
                          if (Number.isNaN(parsed)) return;
                          setManualPreviewCenter((current) => ({
                            ...current,
                            y: clamp(parsed, 0, WORLD_SIZE - 1),
                          }));
                        }}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
                      />
                    </label>
                  </div>
                  <button
                    onClick={() => setManualPreviewCenter(mapCenter)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:border-orange-300"
                  >
                    Use current map center
                  </button>
                </div>
              )}
              <button
                onClick={() => setIsPreviewPickMode((current) => !current)}
                className={`mt-3 w-full rounded border px-2 py-1.5 text-xs font-medium transition ${
                  isPreviewPickMode
                    ? 'border-orange-400 bg-orange-50 text-orange-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-orange-300'
                }`}
              >
                {isPreviewPickMode ? 'Cancel map pick' : 'Pick source on map'}
              </button>
              <p className="mt-1 text-xs text-slate-600">
                Source center: ({activePreviewCenter.x}, {activePreviewCenter.y}) • Radius: {PREVIEW_RADIUS} tiles
              </p>
              <p className="mt-1 text-xs text-slate-500">
                3D preview always renders a {PREVIEW_RADIUS * 2 + 1}x{PREVIEW_RADIUS * 2 + 1} tile window, not the full 500x500 map.
              </p>
            </section>

            <WorldDesigner3DPreview
              title="3D Preview (main-world style)"
              tiles={previewTiles}
              centerX={activePreviewCenter.x}
              centerY={activePreviewCenter.y}
            />

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Terrain Breakdown</h2>
              <div className="mt-2 max-h-52 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                {WORLD_DESIGNER_TERRAINS.map((terrain, index) => (
                  <div key={terrain} className="flex items-center justify-between py-0.5">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TERRAIN_COLORS[terrain] }} />
                      {terrain}
                    </span>
                    <span className="font-medium text-slate-700">{terrainCounts[index]?.toLocaleString() ?? 0}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                The dashed cyan box on the main map shows the exact area used for 3D preview.
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Snapshots</h2>
              <label className="mt-2 block text-sm text-slate-600">
                Selected snapshot
                <select
                  value={selectedSnapshotId ?? ''}
                  onChange={(event) => setSelectedSnapshotId(event.target.value || null)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {snapshots.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-2 block text-sm text-slate-600">
                New snapshot name
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(event) => setSnapshotName(event.target.value)}
                  placeholder="e.g. Delta coast experiment"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={saveSnapshot}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:border-orange-300"
                >
                  Save snapshot
                </button>
                <button
                  onClick={() => selectedSnapshot && loadSnapshot(selectedSnapshot)}
                  disabled={!selectedSnapshot}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:border-orange-300 disabled:opacity-40"
                >
                  Load snapshot
                </button>
                <button
                  onClick={exportSelectedSnapshot}
                  disabled={!selectedSnapshot}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:border-orange-300 disabled:opacity-40"
                >
                  Export JSON
                </button>
                <button
                  onClick={deleteSelectedSnapshot}
                  disabled={!selectedSnapshot}
                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 hover:bg-red-100 disabled:opacity-40"
                >
                  Delete snapshot
                </button>
              </div>

              <label className="mt-3 block text-sm text-slate-600">
                Export payload
                <textarea
                  value={exportJson}
                  onChange={(event) => setExportJson(event.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs"
                />
              </label>

              <label className="mt-2 block text-sm text-slate-600">
                Import payload
                <textarea
                  value={importJson}
                  onChange={(event) => setImportJson(event.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs"
                />
              </label>

              <button
                onClick={importSnapshots}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-orange-300"
              >
                Import snapshots
              </button>
              <div className="mt-2 text-xs text-slate-500">Stored locally in this browser (max {MAX_SNAPSHOTS}).</div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
