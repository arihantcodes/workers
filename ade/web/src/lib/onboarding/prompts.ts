/**
 * The example prompts the setup wizard's last step offers. A project's
 * template declares them in `onboarding.yaml` at the project root, which the
 * ADE serves through `console::onboarding::prompts` (reading and validating
 * the file on every call). An ADE that predates that function gets the
 * harness template's four, built in below, so the step still has something
 * to offer.
 *
 * Each prompt names the agent profile it runs with and a priority list of
 * models: the first one this machine's catalog holds wins.
 */

import { parseCatalogModelKey } from '@/lib/catalog-model-key'
import { getIiiClient } from '@/lib/iii-client'
import { isMissingFunction } from '@/lib/secrets'

/** One `models` entry: a provider's model, and the reasoning effort to use. */
export interface PromptModel {
  /** Router provider id (`claude-code`, `anthropic`, `openai-codex`). */
  provider: string
  /**
   * The model's id, bare (`claude-sonnet-5-5`) or as the provider lists it
   * (`claude-code/claude-sonnet-5-5`).
   */
  model: string
  /** An ADE thinking level (`minimal` … `xhigh`, `off`); absent keeps the default. */
  effort?: string
}

export interface ExamplePrompt {
  title: string
  description?: string
  /** Agent profile id (`ade-worker-builder`, `default`). */
  agent: string
  /** The message prefilled in the composer, never sent by itself. */
  prompt: string
  models: PromptModel[]
}

const PROMPTS_FUNCTION = 'console::onboarding::prompts'

/** The usual priority list: the same model on every provider that serves it. */
const sonnetEverywhere = (effort: string): PromptModel[] => [
  { provider: 'claude-code', model: 'claude-sonnet-5-5', effort },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', effort },
  { provider: 'openai-codex', model: 'gpt-6.1-sol', effort },
  { provider: 'openai', model: 'gpt-6.1-sol', effort },
  { provider: 'github-copilot', model: 'gpt-6.1-sol', effort },
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', effort },
  { provider: 'deepseek', model: 'deepseek-flash' },
]

/**
 * The harness template's `onboarding.yaml`, as shipped: what the step shows
 * when the ADE backend has no `console::onboarding::prompts` to ask.
 */
export const HARNESS_PROMPTS: readonly ExamplePrompt[] = [
  {
    title: 'Build a link shortener',
    description:
      'Short links with their own public page, 302 redirects, and an admin panel',
    agent: 'ade-worker-builder',
    prompt: [
      'Build a link shortener named `link-shortener`.',
      '',
      '- Each link has a name, a target URL (http or https only) and a short code the app generates.',
      '- The public page creates a link, shows and copies its short URL, and lists the saved links.',
      '- `/<worker>/go/<code>` redirects (302) to the target, or answers 404 for an unknown code.',
      '',
      'Test it in the browser: create one link through the form, copy it and open it. No demo records. Leave the public page open at the end.',
    ].join('\n'),
    models: sonnetEverywhere('medium'),
  },
  {
    title: 'Build an expense tracker',
    description:
      'Expenses by category, and a public page with the total still to be reimbursed',
    agent: 'ade-worker-builder',
    prompt:
      'Build an expense tracker. Each expense has a description, an amount, a category, and whether it was reimbursed. Show the total still to be reimbursed.',
    models: sonnetEverywhere('medium'),
  },
  {
    title: 'Create a test reviewer agent',
    description:
      'A reusable agent that reviews your workers and suggests tests',
    agent: 'agent-profile-creator',
    prompt:
      'Create an agent that reviews my workers and suggests useful tests.',
    models: sonnetEverywhere('medium'),
  },
  {
    title: 'Explain this project',
    description: 'What runs here, and what you could work on next',
    agent: 'default',
    prompt: 'Explain this project and help me decide what to work on next.',
    models: sonnetEverywhere('low'),
  },
]

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function promptModel(value: unknown): PromptModel | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const provider = text(row.provider)
  const model = text(row.model)
  if (!provider || !model) return null
  const effort = text(row.effort)
  return { provider, model, ...(effort ? { effort } : {}) }
}

/**
 * The backend's answer, read defensively: it validates already, but an
 * entry the wizard cannot use is dropped rather than rendered half.
 */
export function parseExamplePrompts(value: unknown): ExamplePrompt[] {
  const list =
    value && typeof value === 'object'
      ? (value as { prompts?: unknown }).prompts
      : undefined
  if (!Array.isArray(list)) return []
  const out: ExamplePrompt[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const title = text(row.title)
    const prompt = text(row.prompt)
    const agent = text(row.agent)
    if (!title || !prompt || !agent) continue
    const description = text(row.description)
    const models = Array.isArray(row.models)
      ? row.models
          .map(promptModel)
          .filter((entry): entry is PromptModel => entry !== null)
      : []
    out.push({
      title,
      ...(description ? { description } : {}),
      agent,
      prompt,
      models,
    })
  }
  return out
}

/**
 * The project's example prompts: the ADE's answer when it has one (`[]`
 * for a project that declares none), the harness template's four when the
 * backend predates the function.
 */
export async function fetchExamplePrompts(): Promise<ExamplePrompt[]> {
  const client = await getIiiClient()
  try {
    const result = await client.trigger<unknown>(
      PROMPTS_FUNCTION,
      {},
      { timeoutMs: 5_000 },
    )
    return parseExamplePrompts(result)
  } catch (error) {
    if (isMissingFunction(error)) return [...HARNESS_PROMPTS]
    throw error
  }
}

/** Whether a catalog row (`provider` + its model `id`) is this entry's model. */
export function matchesPromptModel(
  entry: PromptModel,
  row: { provider: string; id: string },
): boolean {
  return (
    row.provider === entry.provider &&
    (row.id === entry.model || row.id.endsWith(`/${entry.model}`))
  )
}

/**
 * The first entry in `entries` this machine can run, as the composer's model
 * (a `provider::id` catalog key) and the entry's effort; `null` when none is
 * in the catalog, so the chat keeps its usual default.
 */
export function resolvePromptModel(
  entries: readonly PromptModel[],
  catalogKeys: readonly string[],
): { model: string; effort?: string } | null {
  const rows = catalogKeys.flatMap((key) => {
    const row = parseCatalogModelKey(key)
    return row ? [{ key, ...row }] : []
  })
  for (const entry of entries) {
    const row = rows.find((candidate) => matchesPromptModel(entry, candidate))
    if (row) {
      return {
        model: row.key,
        ...(entry.effort ? { effort: entry.effort } : {}),
      }
    }
  }
  return null
}
