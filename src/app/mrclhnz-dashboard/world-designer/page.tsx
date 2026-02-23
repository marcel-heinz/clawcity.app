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

const STORAGE_KEY = 'clawcity-world-designer-snapshots-v1';
const MAX_SNAPSHOTS = 10;
const MAX_HISTORY = 160;
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
    zoom: 2,
  });
  const viewStateRef = useRef<ViewState>(viewState);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 680 });

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

  const selectedTerrain = indexToTerrain(selectedTerrainIndex);

  const selectedSnapshot = useMemo(
    () => snapshots.find((item) => item.id === selectedSnapshotId) ?? null,
    [snapshots, selectedSnapshotId]
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
      const fitZoomX = width / WORLD_SIZE;
      const fitZoomY = height / WORLD_SIZE;
      const minZoom = Math.max(0.35, fitZoomX, fitZoomY);
      const zoom = clamp(next.zoom, minZoom, 28);
      const srcW = width / zoom;
      const srcH = height / zoom;

      const maxX = WORLD_SIZE - srcW;
      const maxY = WORLD_SIZE - srcH;

      const x = maxX <= 0 ? (WORLD_SIZE - srcW) * 0.5 : clamp(next.x, 0, maxX);
      const y = maxY <= 0 ? (WORLD_SIZE - srcH) * 0.5 : clamp(next.y, 0, maxY);
      return { x, y, zoom };
    },
    [canvasSize.height, canvasSize.width]
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!canvas || !offscreen) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = viewStateRef.current;
    const srcW = canvasSize.width / state.zoom;
    const srcH = canvasSize.height / state.zoom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, state.x, state.y, srcW, srcH, 0, 0, canvas.width, canvas.height);

    if (showGrid && state.zoom >= 2.4) {
      const startX = Math.floor(state.x);
      const endX = Math.ceil(state.x + srcW);
      const startY = Math.floor(state.y);
      const endY = Math.ceil(state.y + srcH);

      ctx.save();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let x = startX; x <= endX; x++) {
        const screenX = (x - state.x) * state.zoom;
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, canvas.height);
      }
      for (let y = startY; y <= endY; y++) {
        const screenY = (y - state.y) * state.zoom;
        ctx.moveTo(0, screenY);
        ctx.lineTo(canvas.width, screenY);
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
      const sx = (x0 - state.x) * state.zoom;
      const sy = (y0 - state.y) * state.zoom;
      const sw = (x1 - x0 + 1) * state.zoom;
      const sh = (y1 - y0 + 1) * state.zoom;

      ctx.save();
      ctx.fillStyle = 'rgba(249, 115, 22, 0.18)';
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.restore();
    }

    const previewRadius = 26;
    const previewCenterX = clamp(Math.round(state.x + srcW * 0.5), 0, WORLD_SIZE - 1);
    const previewCenterY = clamp(Math.round(state.y + srcH * 0.5), 0, WORLD_SIZE - 1);
    const previewMinX = previewCenterX - previewRadius;
    const previewMinY = previewCenterY - previewRadius;
    const previewSize = previewRadius * 2 + 1;

    ctx.save();
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      (previewMinX - state.x) * state.zoom,
      (previewMinY - state.y) * state.zoom,
      previewSize * state.zoom,
      previewSize * state.zoom
    );
    ctx.restore();
  }, [canvasSize.height, canvasSize.width, showGrid]);

  const getTileFromPointer = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;

      const state = viewStateRef.current;
      const x = Math.floor(state.x + px / state.zoom);
      const y = Math.floor(state.y + py / state.zoom);
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return null;
      return { x, y };
    },
    []
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
    setViewState((current) => clampViewState(current));
  }, [canvasSize.height, canvasSize.width, clampViewState]);

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

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const current = viewStateRef.current;
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = clamp(current.zoom * zoomFactor, 0.35, 28);

    const worldX = current.x + px / current.zoom;
    const worldY = current.y + py / current.zoom;
    const nextState = clampViewState({
      x: worldX - px / nextZoom,
      y: worldY - py / nextZoom,
      zoom: nextZoom,
    });

    viewStateRef.current = nextState;
    setViewState(nextState);
    drawCanvas();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const tile = getTileFromPointer(event.clientX, event.clientY);
    if (!tile) return;

    const shouldPan = event.button === 1 || event.button === 2 || isSpacePressedRef.current;
    const interaction = interactionRef.current;
    interaction.pointerId = event.pointerId;
    interaction.startClientX = event.clientX;
    interaction.startClientY = event.clientY;
    interaction.startViewX = viewStateRef.current.x;
    interaction.startViewY = viewStateRef.current.y;
    interaction.lastTileX = tile.x;
    interaction.lastTileY = tile.y;

    const canvas = canvasRef.current;
    if (canvas) canvas.setPointerCapture(event.pointerId);

    if (shouldPan) {
      interaction.mode = 'pan';
      return;
    }

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

  const previewCenter = useMemo(() => {
    const state = viewState;
    const srcW = canvasSize.width / state.zoom;
    const srcH = canvasSize.height / state.zoom;
    return {
      x: clamp(Math.round(state.x + srcW * 0.5), 0, WORLD_SIZE - 1),
      y: clamp(Math.round(state.y + srcH * 0.5), 0, WORLD_SIZE - 1),
    };
  }, [canvasSize.height, canvasSize.width, viewState]);

  const previewTiles = useMemo(
    () => {
      void previewVersion;
      return extractTileWindow(worldRef.current, previewCenter.x, previewCenter.y, 26);
    },
    [previewCenter.x, previewCenter.y, previewVersion]
  );

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
                Navigation: wheel zoom, drag pan with right-click or hold space.
              </p>
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
                <div className="text-xs text-slate-500">
                  Center: ({previewCenter.x}, {previewCenter.y}) • Zoom {viewState.zoom.toFixed(2)}x
                </div>
              </div>
              <div ref={viewportRef} className="relative h-[700px] w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
                <canvas
                  ref={canvasRef}
                  className="h-full w-full touch-none cursor-crosshair"
                  onWheel={handleWheel}
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

            <WorldDesigner3DPreview
              title="3D Preview (main-world style)"
              tiles={previewTiles}
              centerX={previewCenter.x}
              centerY={previewCenter.y}
            />

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
