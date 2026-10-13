// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineLog, seconds } from './parts'
import type { ActivityEntry } from './use-onboarding'

const NOW = new Date('2026-10-13T10:00:00Z').getTime()

let container: HTMLDivElement
let root: Root
const scrollIntoView = vi.fn()

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  // jsdom lays nothing out, so it has no scrollIntoView.
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const entry = (startedAgoMs: number, noteAgoMs = startedAgoMs) =>
  ({
    id: 1,
    group: 'models',
    title: 'Wait for OpenAI models',
    status: 'running',
    note: 'Waiting on response from OpenAI',
    startedAt: NOW - startedAgoMs,
    noteAt: NOW - noteAgoMs,
  }) satisfies ActivityEntry

const skipButton = () =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Skip for now',
  )

/** The "taking longer" row is open: shown, and reachable (not inert). */
const slowOpen = () => {
  const button = skipButton()
  return button !== undefined && button.closest('[inert]') === null
}

describe('EngineLog while a step runs', () => {
  it('says what the step waits on and counts the seconds', () => {
    act(() =>
      root.render(
        <EngineLog
          plan={[]}
          entries={[entry(12_000)]}
          running
          onSkip={vi.fn()}
        />,
      ),
    )
    expect(container.textContent).toContain(
      'Waiting on response from OpenAI (12s)',
    )
    act(() => vi.advanceTimersByTime(3_000))
    expect(container.textContent).toContain('(15s)')
    expect(slowOpen()).toBe(false)
  })

  it('offers Skip for now once a step runs past 30 seconds', () => {
    const onSkip = vi.fn()
    act(() =>
      root.render(
        <EngineLog
          plan={[]}
          entries={[entry(25_000)]}
          running
          onSkip={onSkip}
        />,
      ),
    )
    expect(slowOpen()).toBe(false)
    act(() => vi.advanceTimersByTime(5_000))
    expect(slowOpen()).toBe(true)
    expect(container.textContent).toContain('Taking longer than usual')
    act(() => skipButton()?.click())
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('counts from the latest progress line, not the start of the step', () => {
    act(() =>
      root.render(
        <EngineLog
          plan={[]}
          entries={[entry(40_000, 4_000)]}
          running
          onSkip={vi.fn()}
        />,
      ),
    )
    expect(container.textContent).toContain('(4s)')
    // Still slow: the step itself started 40 s ago.
    expect(slowOpen()).toBe(true)
  })
})

describe('EngineLog as Continue starts installing', () => {
  /** The log's own body: folded, it is inert. */
  const logOpen = () =>
    container.querySelector('[aria-label="Engine log"]')?.closest('[inert]') ===
    null

  it('opens the log and brings it into view once the run has a step', () => {
    const plan = [
      { kind: 'wait-models', providerId: 'openai', title: 'OpenAI' } as const,
    ]
    act(() =>
      root.render(<EngineLog plan={plan} entries={[]} running={false} />),
    )
    expect(logOpen()).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()

    // Running before its first entry lands: nothing to show yet.
    act(() => root.render(<EngineLog plan={plan} entries={[]} running />))
    expect(scrollIntoView).not.toHaveBeenCalled()

    act(() =>
      root.render(<EngineLog plan={plan} entries={[entry(0)]} running />),
    )
    expect(logOpen()).toBe(true)
    const [options] = scrollIntoView.mock.calls[0] ?? []
    expect(options).toMatchObject({ block: 'start' })
  })

  it('reveals once per run, so folding it again sticks', () => {
    act(() => root.render(<EngineLog plan={[]} entries={[entry(0)]} running />))
    const first = scrollIntoView.mock.calls.length
    // The person folds it; the run carries on with a second step.
    act(() => {
      const toggle = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Engine log'),
      )
      toggle?.click()
    })
    expect(logOpen()).toBe(false)
    act(() =>
      root.render(
        <EngineLog
          plan={[]}
          entries={[
            { ...entry(0), status: 'done' },
            { ...entry(0), id: 2 },
          ]}
          running
        />,
      ),
    )
    expect(logOpen()).toBe(false)
    expect(scrollIntoView.mock.calls.length).toBe(first)
  })
})

describe('seconds', () => {
  it('reads like the CLI', () => {
    expect(seconds(NOW, NOW - 9_400)).toBe('9s')
    expect(seconds(NOW, NOW - 65_000)).toBe('1m 05s')
    expect(seconds(NOW, undefined)).toBe('0s')
  })
})
