import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runStep } from './api'
import type { PlanStep } from './plan'

const trigger = vi.fn()

vi.mock('@/lib/iii-client', () => ({
  getIiiClient: async () => ({ trigger }),
}))

const META = {
  name: 'DEEPSEEK_API_KEY',
  hint: 'sk-e2e…7777',
  consumers: ['llm-router'],
}

const context = {
  consoleConfig: null,
  signal: { cancelled: false },
  report: () => undefined,
}

function storeStep(
  input: Extract<PlanStep, { kind: 'store-secret' }>['input'],
): PlanStep {
  return {
    kind: 'store-secret',
    name: 'DEEPSEEK_API_KEY',
    input,
    from: 'this project’s .env.staging',
    consumers: ['llm-router'],
    envFile: '.env.staging',
  }
}

describe('runStep store-secret', () => {
  beforeEach(() => {
    trigger.mockReset()
    trigger.mockImplementation(async (fn: string) =>
      fn === 'secrets::get' ? null : META,
    )
  })

  it('says who may read a variable shared as it is, not that it was stored', async () => {
    const result = await runStep(storeStep({ mode: 'env' }), context)
    expect(result.note).toBe('llm-router can read it')
    expect(trigger).toHaveBeenCalledWith(
      'secrets::access',
      { name: 'DEEPSEEK_API_KEY', consumers: ['llm-router'], store: 'env' },
      expect.anything(),
    )
  })

  it('names the env file a pasted key was written to', async () => {
    const result = await runStep(
      storeStep({ mode: 'paste', value: 'sk-e2e-pasted-7777', store: 'env' }),
      context,
    )
    expect(result.note).toBe('written to .env.staging (sk-e2e…7777)')
  })

  it('keeps saying stored for the encrypted store', async () => {
    const result = await runStep(
      storeStep({ mode: 'paste', value: 'sk-e2e-pasted-7777' }),
      context,
    )
    expect(result.note).toBe('stored sk-e2e…7777')
  })
})

describe('runStep add-workers', () => {
  const FILE = '/repo/harness/worker-compose.yaml'
  const installed = new Set<string>()
  /** One connected worker, as `engine::workers::list` describes it. */
  const summary = (name: string) => ({
    id: name,
    name,
    status: 'connected',
    function_count: 1,
    connected_at_ms: 0,
    active_invocations: 0,
  })

  beforeEach(() => {
    installed.clear()
    trigger.mockReset()
    trigger.mockImplementation(async (fn: string) => {
      if (fn === 'compose::list') {
        return { projects: [{ file: FILE, namespace: 'my-project' }] }
      }
      if (fn === 'compose::add') {
        installed.add('provider-claude-code')
        return { operation_id: undefined }
      }
      // engine::workers::list, before and after the add
      return { workers: [...installed].map(summary) }
    })
  })

  it('names the file the daemon loaded, not whatever is in its working directory', async () => {
    await runStep(
      {
        kind: 'add-workers',
        workers: ['provider-claude-code'],
        why: { 'provider-claude-code': 'Claude Code' },
      },
      context,
    )
    expect(trigger).toHaveBeenCalledWith(
      'compose::add',
      { file: FILE, workers: ['provider-claude-code'] },
      expect.anything(),
    )
  })

  it('lets compose keep its default when the daemon cannot say', async () => {
    trigger.mockImplementation(async (fn: string) => {
      if (fn === 'compose::list') throw new Error('function_not_found')
      if (fn === 'compose::add') {
        installed.add('provider-claude-code')
        return {}
      }
      return { workers: [...installed].map(summary) }
    })
    await runStep(
      {
        kind: 'add-workers',
        workers: ['provider-claude-code'],
        why: { 'provider-claude-code': 'Claude Code' },
      },
      context,
    )
    expect(trigger).toHaveBeenCalledWith(
      'compose::add',
      { workers: ['provider-claude-code'] },
      expect.anything(),
    )
  })
})
