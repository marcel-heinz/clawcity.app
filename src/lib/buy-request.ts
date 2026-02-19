export interface ParsedBuyRequest {
  itemId: string | null;
  quantity: number;
  usedLegacyItemField: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseQuantity(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(Math.floor(raw), 5));
  }

  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(parsed, 5));
    }
  }

  return 1;
}

function normalizeItemId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseBuyRequestBody(body: unknown): ParsedBuyRequest {
  const record = asRecord(body);
  const itemId = normalizeItemId(record.item_id);

  if (itemId) {
    return {
      itemId,
      quantity: parseQuantity(record.quantity),
      usedLegacyItemField: false,
    };
  }

  const legacyItem = normalizeItemId(record.item);
  return {
    itemId: legacyItem,
    quantity: parseQuantity(record.quantity),
    usedLegacyItemField: legacyItem !== null,
  };
}
