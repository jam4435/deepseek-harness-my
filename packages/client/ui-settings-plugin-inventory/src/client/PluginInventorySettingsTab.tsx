import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type {
  PluginInventoryAction,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /** Apply one lifecycle mutation and receive the refreshed snapshot. */
  mutate: (action: PluginInventoryAction, entryId: string) => Promise<PluginInventorySnapshot>
}

type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

type ConfirmedAction = {
  readonly entryId: string
  readonly action: Exclude<PluginInventoryAction, 'enable'>
}

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [
    entry.moduleName,
    entry.entryId,
    entry.fiberName ?? '',
    ...entry.dependencies,
    ...entry.waitingFor,
    ...entry.providedServices,
  ].some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Render the current Host Loader inventory with lifecycle controls. */
export function PluginInventorySettingsTab({ list, mutate, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [confirmed, setConfirmed] = useState<ConfirmedAction | null>(null)
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [failedEntry, setFailedEntry] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const runAction = async (action: PluginInventoryAction, entry: PluginInventoryEntry): Promise<void> => {
    if (action === 'disable' || action === 'restart') {
      if (confirmed?.entryId !== entry.entryId || confirmed.action !== action) {
        setConfirmed({ entryId: entry.entryId, action })
        setFailedEntry(null)
        return
      }
    }
    setConfirmed(null)
    setBusyEntry(entry.entryId)
    setFailedEntry(null)
    try {
      const snapshot = await mutate(action, entry.entryId)
      setState({ status: 'ready', snapshot })
    } catch {
      setFailedEntry(entry.entryId)
      try {
        const snapshot = await list()
        setState({ status: 'ready', snapshot })
      } catch {
        // The action failure is already surfaced; keeping the last readable
        // snapshot is safer than replacing it with a second load error.
      }
    } finally {
      setBusyEntry(null)
    }
  }

  const mutationsEnabled = state.status === 'ready' && state.snapshot.mutationsEnabled

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {!mutationsEnabled ? <p className={css.status}>{t('mutationsDisabled')}</p> : null}
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                const busy = busyEntry === entry.entryId
                const confirmingDisable = confirmed?.entryId === entry.entryId && confirmed.action === 'disable'
                const confirmingRestart = confirmed?.entryId === entry.entryId && confirmed.action === 'restart'
                return (
                  <li
                    className={css.card}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-open={open ? 'true' : undefined}
                    aria-busy={busy ? 'true' : undefined}
                  >
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                      onClick={() => {
                        setExpanded(current => current === entry.entryId ? null : entry.entryId)
                        setConfirmed(null)
                        setFailedEntry(null)
                      }}
                    >
                      <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                      <span className={css.cardTrailing}>
                        {entry.enabled ? (
                          <span
                            className={css.statusDot}
                            data-phase={entry.fiberPhase ?? 'unobserved'}
                            role="img"
                            aria-label={status}
                            title={status}
                          />
                        ) : null}
                        <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                          {configuration}
                        </span>
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('configuration')}</dt>
                            <dd>{configuration}</dd>
                          </div>
                          {entry.enabled ? (
                            <div>
                              <dt>{t('cordis')}</dt>
                              <dd>{status}</dd>
                            </div>
                          ) : null}
                          {entry.enabled ? (
                            <div>
                              <dt>{t('pluginInstance')}</dt>
                              <dd>{entry.fiberName ?? t('unobserved')}</dd>
                            </div>
                          ) : null}
                          {entry.enabled && entry.dependencies.length > 0 ? (
                            <div>
                              <dt>{t('dependencies')}</dt>
                              <dd>{entry.dependencies.join(', ')}</dd>
                            </div>
                          ) : null}
                          {entry.enabled && entry.waitingFor.length > 0 ? (
                            <div>
                              <dt>{t('waitingFor')}</dt>
                              <dd>{entry.waitingFor.join(', ')}</dd>
                            </div>
                          ) : null}
                          {entry.enabled && entry.providedServices.length > 0 ? (
                            <div>
                              <dt>{t('provides')}</dt>
                              <dd>{entry.providedServices.join(', ')}</dd>
                            </div>
                          ) : null}
                        </dl>
                        {failedEntry === entry.entryId ? (
                          <p className={css.actionFailure} role="alert">{t('actionFailed')}</p>
                        ) : null}
                        {mutationsEnabled ? (
                          <div className={css.actions}>
                            {entry.enabled ? (
                              <>
                                <button
                                  className={css.actionButton}
                                  type="button"
                                  disabled={busy}
                                  data-confirm={confirmingDisable ? 'true' : undefined}
                                  onClick={() => { void runAction('disable', entry) }}
                                >
                                  {confirmingDisable ? t('confirmDisable') : t('disable')}
                                </button>
                                <button
                                  className={css.actionButton}
                                  type="button"
                                  disabled={busy}
                                  data-confirm={confirmingRestart ? 'true' : undefined}
                                  onClick={() => { void runAction('restart', entry) }}
                                >
                                  {confirmingRestart ? t('confirmRestart') : t('restart')}
                                </button>
                              </>
                            ) : (
                              <button
                                className={css.actionButton}
                                type="button"
                                disabled={busy}
                                onClick={() => { void runAction('enable', entry) }}
                              >
                                {t('enable')}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
