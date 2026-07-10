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
        '20260710007000_paginate_today_call_list_by_fuel_category.sql',
      ),
      'utf8',
    )

    expect(migration).toContain('fuel_category_filter text default null')
    expect(migration).toContain('public.get_fuel_queue_category(fuel_type) = effective_fuel_category_filter')
    expect(migration).toContain("'category_counts', jsonb_build_object")
    expect(migration).toContain('from filtered_base')
  })
})
