import { NextResponse } from 'next/server';
import { availableModels } from '@/server/llm';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ models: availableModels() });
}
