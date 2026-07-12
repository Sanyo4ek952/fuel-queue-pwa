import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('today call list category pagination migration', () => {
  it('filters page rows by fuel category while keeping summary counts unfiltered by category', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260712000000_initial_city_queue.sql',
      ),
      'utf8',
    )

    expect(migration).toContain('"fuel_category_filter" "text" DEFAULT NULL::"text"')
    expect(migration).toContain('effective_fuel_category = fuel_category_filter')
    expect(migration).toContain("'category_counts', jsonb_build_object")
    expect(migration).toContain('from filtered')
    expect(migration).toContain("'total_count', (select count(*) from base)")
  })
})
