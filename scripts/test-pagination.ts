#!/usr/bin/env tsx

import { paginateAscendingItems } from '../src/helpers/pagination.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const items = Array.from({ length: 35 }, (_, index) => ({ block_number: 100, index }))
const first = paginateAscendingItems(items, 10, (item) => item.block_number)
assert(first.pageItems[0].index === 25 && first.pageItems[9].index === 34, 'first page should contain newest items')
assert(first.nextBoundary?.skip_inclusive_block === 10, 'first cursor should skip ten same-block items')

const second = paginateAscendingItems(items, 10, (item) => item.block_number, first.nextBoundary)
assert(second.pageItems[0].index === 15 && second.pageItems[9].index === 24, 'second page should not repeat the first')
assert(second.nextBoundary?.skip_inclusive_block === 20, 'second cursor should accumulate same-block skip count')

const third = paginateAscendingItems(items, 10, (item) => item.block_number, second.nextBoundary)
assert(third.pageItems[0].index === 5 && third.pageItems[9].index === 14, 'third page should keep moving backward')
assert(third.nextBoundary?.skip_inclusive_block === 30, 'third cursor should retain cumulative same-block progress')

const last = paginateAscendingItems(items, 10, (item) => item.block_number, third.nextBoundary)
assert(last.pageItems.length === 5 && last.pageItems[0].index === 0, 'last page should return the remaining rows')
assert(!last.hasMore && last.nextBoundary === undefined, 'last page should finish without another cursor')

console.log('PASS  same-block continuation cursors advance without repeats or gaps')
