import { supabase } from './supabase'
import { isMissingTable } from './errors'
import type { Expense, NewExpense } from './types'

const key = (userId: string) => `bubutravel:expenses:${userId}`

function localRows(userId: string): Expense[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) ?? '[]') as Expense[]
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeLocal(userId: string, rows: Expense[]) {
  localStorage.setItem(key(userId), JSON.stringify(rows))
}

export async function fetchExpenses(userId: string): Promise<{ rows: Expense[]; localOnly: boolean }> {
  const pending = localRows(userId)
  try {
    if (pending.length > 0) {
      const upload = pending.map(({ created_at: _createdAt, ...row }) => row)
      const { error: syncError } = await supabase.from('expenses').upsert(upload)
      if (syncError) throw syncError
      writeLocal(userId, [])
    }
    const { data, error } = await supabase.from('expenses').select('*').order('spent_at', { ascending: false })
    if (error) throw error
    return { rows: data ?? [], localOnly: false }
  } catch (error) {
    if (!isMissingTable(error) && pending.length === 0) throw error
    return { rows: pending, localOnly: true }
  }
}

export async function createExpense(input: NewExpense): Promise<{ row: Expense; localOnly: boolean }> {
  try {
    const { data, error } = await supabase.from('expenses').insert(input).select().single()
    if (error) throw error
    return { row: data, localOnly: false }
  } catch (error) {
    if (!isMissingTable(error)) throw error
    const row: Expense = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }
    writeLocal(input.user_id, [row, ...localRows(input.user_id)])
    return { row, localOnly: true }
  }
}

export async function removeExpense(userId: string, id: string, localOnly: boolean): Promise<void> {
  if (!localOnly) {
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (!error) return
    if (!isMissingTable(error)) throw error
  }
  writeLocal(userId, localRows(userId).filter((row) => row.id !== id))
}
