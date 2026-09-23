import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllLeads, fetchAllPages, LEADS_PAGE_SIZE } from './fetchAllLeads.js'

function row(id, extra = {}) {
  return { id, ...extra }
}

test('fetchAllPages concatenates pages until a short page', async () => {
  const calls = []
  const pages = [
    [row('a'), row('b')],
    [row('c'), row('d')],
    [row('e')],
  ]

  const rows = await fetchAllPages((from, to) => {
    calls.push([from, to])
    const index = calls.length - 1
    return Promise.resolve({ data: pages[index], error: null })
  }, { pageSize: 2 })

  assert.deepEqual(calls, [[0, 1], [2, 3], [4, 5]])
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'c', 'd', 'e'])
})

test('fetchAllPages requests one extra page when a page is exactly full', async () => {
  const calls = []
  const rows = await fetchAllPages((from, to) => {
    calls.push([from, to])
    const data = calls.length === 1 ? [row(1), row(2)] : []
    return Promise.resolve({ data, error: null })
  }, { pageSize: 2 })

  assert.deepEqual(calls, [[0, 1], [2, 3]])
  assert.deepEqual(rows.map(r => r.id), [1, 2])
})

test('fetchAllPages reads past the default 1000-row cap', async () => {
  const total = LEADS_PAGE_SIZE + 34
  const all = Array.from({ length: total }, (_, i) => row(`lead-${i}`))

  const rows = await fetchAllPages((from, to) => {
    return Promise.resolve({ data: all.slice(from, to + 1), error: null })
  })

  assert.equal(LEADS_PAGE_SIZE, 1000)
  assert.equal(rows.length, total)
  assert.equal(rows[0].id, 'lead-0')
  assert.equal(rows[rows.length - 1].id, `lead-${total - 1}`)
})

test('fetchAllPages throws on a page error instead of returning a truncated set', async () => {
  await assert.rejects(
    () => fetchAllPages((from) => {
      if (from === 0) return Promise.resolve({ data: [row('a'), row('b')], error: null })
      return Promise.resolve({ data: null, error: { message: 'range failed' } })
    }, { pageSize: 2 }),
    /range failed/,
  )
})

test('fetchAllPages stops when a later page repeats ids', async () => {
  let calls = 0
  const rows = await fetchAllPages(() => {
    calls += 1
    return Promise.resolve({ data: [row('a'), row('b')], error: null })
  }, { pageSize: 2 })

  assert.equal(calls, 2)
  assert.deepEqual(rows.map(r => r.id), ['a', 'b'])
})

test('fetchAllPages rejects a non-positive page size', async () => {
  await assert.rejects(
    () => fetchAllPages(() => Promise.resolve({ data: [], error: null }), { pageSize: 0 }),
    /pageSize/,
  )
})

function createFakeClient(pages) {
  const calls = []
  const client = {
    from(table) {
      return {
        select(columns) {
          const state = { table, columns, filters: [], orders: [] }
          const builder = {
            gte(column, value) {
              state.filters.push(['gte', column, value])
              return builder
            },
            not(column, operator, value) {
              state.filters.push(['not', column, operator, value])
              return builder
            },
            order(column, options) {
              state.orders.push([column, options?.ascending !== false ? 'asc' : 'desc'])
              return builder
            },
            range(from, to) {
              const call = {
                table: state.table,
                columns: state.columns,
                filters: state.filters.map(entry => [...entry]),
                orders: state.orders.map(entry => [...entry]),
                from,
                to,
              }
              calls.push(call)
              const data = pages[calls.length - 1] ?? []
              return Promise.resolve({ data, error: null })
            },
          }
          return builder
        },
      }
    },
  }
  return { client, calls }
}

test('fetchAllLeads reapplies filters and date order on every page', async () => {
  const start = '2024-01-01T00:00:00.000Z'
  const { client, calls } = createFakeClient([
    [row('1', { created_at: start }), row('2', { created_at: start })],
    [row('3', { created_at: start })],
  ])

  const rows = await fetchAllLeads(client, {
    pageSize: 2,
    modify: (query) => query.gte('created_at', start).order('created_at', { ascending: true }),
  })

  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.table, 'leads')
    assert.equal(call.columns, '*')
    assert.deepEqual(call.filters, [['gte', 'created_at', start]])
    assert.deepEqual(call.orders, [['created_at', 'asc'], ['id', 'asc']])
  }
  assert.deepEqual(calls.map(call => [call.from, call.to]), [[0, 1], [2, 3]])
  assert.deepEqual(rows.map(r => r.id), ['1', '2', '3'])
})

test('fetchAllLeads keeps column list and row filters used by the map', async () => {
  const columns = 'id, latitude, longitude'
  const { client, calls } = createFakeClient([
    [row('1'), row('2')],
    [],
  ])

  const rows = await fetchAllLeads(client, {
    columns,
    pageSize: 2,
    modify: (query) => query.not('latitude', 'is', null).not('longitude', 'is', null),
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].columns, columns)
  assert.deepEqual(calls[0].filters, [
    ['not', 'latitude', 'is', null],
    ['not', 'longitude', 'is', null],
  ])
  assert.deepEqual(calls[0].orders, [['id', 'asc']])
  assert.deepEqual(rows.map(r => r.id), ['1', '2'])
})

test('fetchAllLeads uses the 1000-row page size by default', async () => {
  const { client, calls } = createFakeClient([[]])
  await fetchAllLeads(client, {
    modify: (query) => query.order('created_at', { ascending: false }),
  })

  assert.deepEqual(calls[0].orders, [['created_at', 'desc'], ['id', 'asc']])
  assert.deepEqual([calls[0].from, calls[0].to], [0, LEADS_PAGE_SIZE - 1])
})
