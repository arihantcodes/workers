// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineLog, seconds } from './parts'
import type { ActivityEntry } from './use-onboarding'

const NOW = new Date('2026-10-13T10:00:00Z').getTime()

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
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

describe('seconds', () => {
  it('reads like the CLI', () => {
    expect(seconds(NOW, NOW - 9_400)).toBe('9s')
    expect(seconds(NOW, NOW - 65_000)).toBe('1m 05s')
    expect(seconds(NOW, undefined)).toBe('0s')
  })
})
