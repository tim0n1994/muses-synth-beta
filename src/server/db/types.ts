import type Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function toIsoTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid date");
  }
  return date.toISOString();
}
