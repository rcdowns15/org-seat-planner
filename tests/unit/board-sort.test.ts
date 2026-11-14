import { describe, expect, it } from "vitest";
import type { BoardSeat } from "@/lib/board";
import { sortSeats } from "@/lib/board-sort";

const seat = (seatId: number, status: BoardSeat["status"]) => ({ seatId, status }) as BoardSeat;

describe("sortSeats", () => {
  it("puts open and backfill first, then offer_accepted, then filled", () => {
    const sorted = sortSeats([
      seat(1, "filled"),
      seat(2, "offer_accepted"),
      seat(3, "backfill"),
      seat(4, "open"),
      seat(5, "filled"),
    ]);
    expect(sorted.map((s) => s.seatId)).toEqual([3, 4, 2, 1, 5]);
  });

  it("is ordered by seat label inside a group, with numbers compared as numbers", () => {
    const sorted = sortSeats([seat(72, "open"), seat(9, "backfill"), seat(100, "open")]);
    expect(sorted.map((s) => s.seatId)).toEqual([9, 72, 100]);
  });

  it("does not change the input array", () => {
    const input = [seat(2, "filled"), seat(1, "open")];
    sortSeats(input);
    expect(input.map((s) => s.seatId)).toEqual([2, 1]);
  });
});
