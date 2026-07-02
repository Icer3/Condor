// Strategy preset marketplace (lightweight version).
// Server-side preset store in .data/presets.json keyed by preset id.
// GET = list, POST = add, PUT = update, DELETE = remove.
// Without auth, this is "share via URL" rather than a real marketplace.

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'presets.json');

export interface StrategyPreset {
  id: string;
  name: string;
  author: string;
  ticker: string;
  strategyId: string;
  params: { delta?: number; wingWidth?: number; daysToExpiry?: number };
  notes: string;
  createdAt: string;
}

type Store = Record<string, StrategyPreset[]>;

async function readStore(): Promise<Store> {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf-8')) as Store; } catch { return {}; }
}
async function writeStore(s: Store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const store = await readStore();
  if (ticker) return NextResponse.json({ presets: store[ticker.toUpperCase()] ?? [] });
  return NextResponse.json({ presets: Object.entries(store).flatMap(([t, ps]) => ps.map(p => ({ ...p, ticker: t }))) });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { ticker, name, author = 'anon', strategyId, params = {}, notes = '', id } = body || {};
  if (!ticker || !name || !strategyId || !id) {
    return NextResponse.json({ error: 'id, ticker, name, strategyId required' }, { status: 400 });
  }
  const preset: StrategyPreset = { id, ticker: ticker.toUpperCase(), name, author, strategyId, params, notes, createdAt: new Date().toISOString() };
  const store = await readStore();
  const list = store[preset.ticker] ?? [];
  const idx = list.findIndex(p => p.id === id);
  if (idx >= 0) list[idx] = preset; else list.push(preset);
  store[preset.ticker] = list;
  await writeStore(store);
  return NextResponse.json({ ok: true, preset });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const ticker = url.searchParams.get('ticker');
  if (!id || !ticker) return NextResponse.json({ error: 'id, ticker required' }, { status: 400 });
  const store = await readStore();
  if (store[ticker.toUpperCase()]) {
    store[ticker.toUpperCase()] = store[ticker.toUpperCase()].filter(p => p.id !== id);
    await writeStore(store);
  }
  return NextResponse.json({ ok: true });
}
