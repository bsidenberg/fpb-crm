// PostgREST (and hosted Supabase) caps a single response at max-rows, which
// defaults to 1000. A select without .range() silently returns only that first
// page. Page with an inclusive range until a short page comes back.

export const LEADS_PAGE_SIZE = 1000

/**
 * Pull every row by calling `fetchPage(from, to)` with inclusive indexes.
 * Stops on a short page, an empty page, or a page that adds no new ids
 * (guards a server that ignores Range and would otherwise loop).
 *
 * @param {(from: number, to: number) => Promise<{ data?: unknown[] | null, error?: { message?: string } | null }>} fetchPage
 * @param {{ pageSize?: number }} [options]
 * @returns {Promise<unknown[]>}
 */
export async function fetchAllPages(fetchPage, { pageSize = LEADS_PAGE_SIZE } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`pageSize must be a positive integer, got ${pageSize}`)
  }

  const rows = []
  const seenIds = new Set()
  let from = 0

  for (;;) {
    const result = await fetchPage(from, from + pageSize - 1)
    const error = result?.error
    if (error) {
      const message = typeof error === 'string'
        ? error
        : (error.message || 'Failed to fetch rows')
      throw new Error(message)
    }

    const page = Array.isArray(result?.data) ? result.data : []
    let added = 0
    for (const row of page) {
      const id = row?.id
      if (id != null) {
        if (seenIds.has(id)) continue
        seenIds.add(id)
      }
      rows.push(row)
      added += 1
    }

    if (page.length < pageSize || added === 0) return rows
    from += pageSize
  }
}

/**
 * Load every matching lead, preserving caller filters and sort.
 * `modify` receives a fresh `from('leads').select(columns)` builder per page
 * and may add filters and `.order()`. An `id` tie-break is always applied so
 * rows that share a sort key are not skipped between pages.
 *
 * @param {{ from: (table: string) => { select: (columns: string) => object } }} client
 * @param {{ columns?: string, modify?: (query: object) => object, pageSize?: number }} [options]
 */
export async function fetchAllLeads(client, { columns = '*', modify, pageSize = LEADS_PAGE_SIZE } = {}) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('fetchAllLeads requires a Supabase client')
  }

  return fetchAllPages((from, to) => {
    let query = client.from('leads').select(columns)
    if (typeof modify === 'function') {
      const next = modify(query)
      if (next) query = next
    }
    return query.order('id', { ascending: true }).range(from, to)
  }, { pageSize })
}
