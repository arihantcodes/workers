import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchExamplePrompts,
  HARNESS_PROMPTS,
  type PromptModel,
  parseExamplePrompts,
  resolvePromptModel,
} from './prompts'

const trigger = vi.fn()

vi.mock('@/lib/iii-client', () => ({
  getIiiClient: async () => ({ trigger }),
}))

const PRIORITY: PromptModel[] = [
  { provider: 'claude-code', model: 'claude-sonnet-5-5', effort: 'medium' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' },
  { provider: 'openai-codex', model: 'gpt-6.1-sol', effort: 'high' },
  { provider: 'openai', model: 'gpt-6.1-sol' },
]

describe('resolvePromptModel', () => {
  it('takes the first entry this machine has, in the order the prompt lists them', () => {
    expect(
      resolvePromptModel(PRIORITY, [
        'openai::gpt-6.1-sol',
        'anthropic::claude-sonnet-5-5',
        'claude-code::claude-code/claude-sonnet-5-5',
      ]),
    ).toEqual({
      model: 'claude-code::claude-code/claude-sonnet-5-5',
      effort: 'medium',
    })
  })

  it('matches a provider-prefixed id by its last segment, and a bare id exactly', () => {
    expect(
      resolvePromptModel(PRIORITY, [
        'openai-codex::codex/gpt-6.1-sol',
        'anthropic::claude-sonnet-5-5-latest',
      ]),
    ).toEqual({ model: 'openai-codex::codex/gpt-6.1-sol', effort: 'high' })
  })

  it('never matches another provider serving the same model id', () => {
    expect(
      resolvePromptModel(
        [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }],
        ['openrouter::openrouter/anthropic/claude-sonnet-5-5'],
      ),
    ).toBeNull()
  })

  it('is null when nothing in the list is available, so the chat keeps its default', () => {
    expect(resolvePromptModel(PRIORITY, ['deepseek::deepseek-flash'])).toBe(
      null,
    )
    expect(resolvePromptModel([], ['openai::gpt-6.1-sol'])).toBeNull()
  })
})

describe('parseExamplePrompts', () => {
  it('keeps the usable entries and drops the rest', () => {
    expect(
      parseExamplePrompts({
        prompts: [
          {
            title: ' Build a TODO app ',
            description: 'A todo list',
            agent: 'ade-worker-builder',
            prompt: 'Build a TODO app.',
            models: [
              { provider: 'claude-code', model: 'claude-sonnet-5-5' },
              { provider: '', model: 'nope' },
            ],
          },
          { title: 'No prompt', agent: 'default' },
          'not an object',
        ],
      }),
    ).toEqual([
      {
        title: 'Build a TODO app',
        description: 'A todo list',
        agent: 'ade-worker-builder',
        prompt: 'Build a TODO app.',
        models: [{ provider: 'claude-code', model: 'claude-sonnet-5-5' }],
      },
    ])
    expect(parseExamplePrompts(null)).toEqual([])
  })
})

describe('fetchExamplePrompts', () => {
  // Braces on purpose: `mockReset()` returns the mock, and a function
  // returned from `beforeEach` is run as cleanup.
  beforeEach(() => {
    trigger.mockReset()
  })

  it('returns what the ADE serves, and nothing for a project that declares none', async () => {
    trigger.mockResolvedValue({ prompts: [] })
    expect(await fetchExamplePrompts()).toEqual([])
    expect(trigger).toHaveBeenCalledWith(
      'console::onboarding::prompts',
      {},
      expect.anything(),
    )
  })

  it('falls back to the harness template’s four when the ADE predates the function', async () => {
    trigger.mockRejectedValue(
      new Error('Function console::onboarding::prompts not found'),
    )
    const prompts = await fetchExamplePrompts()
    expect(prompts).toHaveLength(4)
    expect(prompts.map((prompt) => prompt.title)).toEqual(
      HARNESS_PROMPTS.map((prompt) => prompt.title),
    )
  })
})
