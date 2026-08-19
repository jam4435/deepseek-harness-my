// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
type Mutate = PluginInventorySettingsTabInjected['mutate']
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(
  list: PluginInventorySettingsTabInjected['list'],
  mutate: Mutate = vi.fn(),
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    mutate,
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  mutationsEnabled: true,
  entries: [
    {
      entryId: '8a1b2c3d',
      moduleName: '@deepseek-ai/cordis-plugin-hmr',
      enabled: true,
      fiberPhase: 'active',
      fiberName: 'hmr',
      dependencies: ['logger', 'timer'],
      waitingFor: [],
      providedServices: ['logger', 'timer'],
    },
    {
      entryId: 'pending',
      moduleName: 'cordis:pending-name',
      enabled: true,
      fiberPhase: 'pending',
      fiberName: 'pending-name',
      dependencies: ['neverReady'],
      waitingFor: ['neverReady'],
      providedServices: [],
    },
    {
      entryId: 'loading',
      moduleName: '@fixture/loading-name',
      enabled: true,
      fiberPhase: 'loading',
      fiberName: 'loading-name',
      dependencies: [],
      waitingFor: [],
      providedServices: [],
    },
    {
      entryId: 'failed',
      moduleName: '@fixture/failed-name',
      enabled: true,
      fiberPhase: 'failed',
      fiberName: 'failed-name',
      dependencies: [],
      waitingFor: [],
      providedServices: [],
    },
    {
      entryId: 'unloading',
      moduleName: '@fixture/unloading-name',
      enabled: true,
      fiberPhase: 'unloading',
      fiberName: 'unloading-name',
      dependencies: [],
      waitingFor: [],
      providedServices: [],
    },
    {
      entryId: 'unobserved',
      moduleName: '@fixture/unobserved-name',
      enabled: true,
      fiberPhase: null,
      fiberName: null,
      dependencies: [],
      waitingFor: [],
      providedServices: [],
    },
    {
      entryId: 'disabled-entry',
      moduleName: '@deepseek-ai/dsh-host-directory-picker-native',
      enabled: false,
      fiberPhase: null,
      fiberName: null,
      dependencies: [],
      waitingFor: [],
      providedServices: [],
    },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders runtime diagnostics and lifecycle controls only for mounted plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(6)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }

    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    expect(screen.getByText(en.pluginInstance)).toBeTruthy()
    expect(screen.getByText(en.dependencies)).toBeTruthy()
    expect(screen.getAllByText('logger, timer')).toHaveLength(2)
    expect(screen.getByText(en.provides)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.disable })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.restart })).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    const pending = screen.getByRole('button', { name: 'pending-name, Waiting for dependencies, Enabled' })
    fireEvent.click(pending)
    expect(screen.getByText(en.waitingFor)).toBeTruthy()
    expect(screen.getAllByText('neverReady')).toHaveLength(2)
    fireEvent.click(pending)

    const disabled = screen.getByRole('button', { name: 'directory-picker-native, Disabled' })
    fireEvent.click(disabled)
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.getByRole('button', { name: en.enable })).toBeTruthy()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ mutationsEnabled: true, entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })

  it('hides lifecycle controls when the Host disables mutations', async () => {
    const readOnly = { ...SNAPSHOT, mutationsEnabled: false } as Snapshot
    render(<PluginInventorySettingsTab {...props(async () => readOnly)} />)
    expect(await screen.findByText(en.mutationsDisabled)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'hmr, Mounted, Enabled' }))
    expect(screen.queryByRole('button', { name: en.disable })).toBeNull()
    expect(screen.queryByRole('button', { name: en.restart })).toBeNull()
  })

  it('enables a disabled entry from its expanded card', async () => {
    const enabled = SNAPSHOT.entries.map(entry => entry.entryId === 'disabled-entry'
      ? { ...entry, enabled: true, fiberPhase: 'active', fiberName: 'directory-picker' }
      : entry)
    const mutate = vi.fn<Mutate>().mockResolvedValue({ mutationsEnabled: true, entries: enabled } as Snapshot)
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, mutate)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'directory-picker-native, Disabled' }))
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith('enable', 'disabled-entry') })
    expect(await screen.findByRole('button', { name: en.disable })).toBeTruthy()
  })

  it('requires a confirmation step before disabling or restarting', async () => {
    const mutate = vi.fn<Mutate>().mockResolvedValue(SNAPSHOT)
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, mutate)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'hmr, Mounted, Enabled' }))
    const disable = screen.getByRole('button', { name: en.disable })
    fireEvent.click(disable)
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.confirmDisable }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith('disable', '8a1b2c3d') })

    fireEvent.click(screen.getByRole('button', { name: en.restart }))
    expect(mutate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en.confirmRestart }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith('restart', '8a1b2c3d') })
  })

  it('reloads the inventory after a failed mutation and keeps transport detail private', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>().mockResolvedValue(SNAPSHOT)
    const mutate = vi.fn<Mutate>().mockRejectedValue(new Error('private transport detail'))
    render(<PluginInventorySettingsTab {...props(list, mutate)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'hmr, Mounted, Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmDisable }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith('disable', '8a1b2c3d') })
    expect((await screen.findByRole('alert')).textContent).toBe(en.actionFailed)
    expect(screen.queryByText('private transport detail')).toBeNull()
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })
})
