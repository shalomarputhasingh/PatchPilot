import "server-only";
import { NextResponse } from "next/server";
import type { ApiError } from "./types";

export function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>) {
  const body: ApiError = { error: { code, message, ...(fields ? { fields } : {}) } };
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
